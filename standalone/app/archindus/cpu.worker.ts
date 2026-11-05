import ortLoader from "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import { cacheAwareFetch, localCacheOptions } from "./model-cache";
import { env, pipeline, TextStreamer, InterruptableStoppingCriteria, type TextGenerationPipeline } from "@huggingface/transformers";
import { withoutAgentSelection } from "./agents";
import { finalAnswer, modelContext, validateAnswer, type ContextMessage } from "./answer";
import { type TaskPlan } from "./orchestration";
import { AnswerStream } from "./stream";
import { CPU_CHAT, CPU_CODER } from "./device-models";
import { cooperativeStep, localPrompt } from "./local-model";

env.allowLocalModels = false;
env.useBrowserCache = typeof caches !== "undefined";
if (env.backends.onnx.wasm) { env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = {mjs:new URL(ortLoader,self.location.href).href, wasm:"https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.wasm"}; }
type Request = { type: "load" | "generate" | "stop"; requestId: string; cachedOnly?: boolean; modelId?: string; plan: TaskPlan; history: ContextMessage[]; objective: string };
let generator: TextGenerationPipeline | undefined;
let currentModel = "";
let busy = false;
let cachedOnly = true;
self.fetch = cacheAwareFetch(self.fetch.bind(self), typeof caches === "undefined" ? undefined : caches, self.location.origin, () => cachedOnly);
let activeRequest = "";
let interrupted = false;
const stopping = new InterruptableStoppingCriteria();
const post = (requestId: string, data: Record<string, unknown>) => self.postMessage({ requestId, ...data });

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "stop") {
    if (request.requestId === activeRequest) { interrupted = true; stopping.interrupt(); }
    else post(request.requestId, { type: "stopped" });
    return;
  }
  if (busy) { post(request.requestId, { type: "error", error: "A request is already running." }); return; }
  busy = true;
  cachedOnly = request.type !== "load" || request.cachedOnly !== false;
  activeRequest = request.requestId; interrupted = false; stopping.reset();
  let stage = "loading the local model";
  let recoverable = true;
  try {
    const coding = request.plan.task === "code";
    const { id, label } = request.modelId === CPU_CODER.id ? CPU_CODER : CPU_CHAT;
    if (!generator || currentModel !== id) {
      await generator?.dispose();
      generator = undefined;
      generator = await pipeline<"text-generation">("text-generation", id, {
        device: "wasm", dtype: "q4", ...localCacheOptions(env, cachedOnly),
        progress_callback: (report: { progress?: number; status?: string }) => post(request.requestId, { type: "progress", text: `Preparing ${label}`, progress: report.progress ?? 0, model: label }),
      }) as TextGenerationPipeline;
      const forward = generator.model.forward.bind(generator.model);
      generator.model.forward = (...args: Parameters<typeof forward>) => cooperativeStep(() => forward(...args));
      currentModel = id;
    }
    if (interrupted) return;
    if (request.type === "load") { post(request.requestId, { type: "ready", model: label, modelId: id }); return; }
    stage = "preparing the conversation";
    post(request.requestId, { type: "progress", text: "Preparing the answer in CPU compatibility mode", model: label });
    const short = request.plan.task === "chat" && /\b(?:(?:one|two|three|four|[1-4])[- ](?:line|sentence)|short|brief|concise)\b/i.test(request.objective);
    const limit = coding || request.plan.task === "document" ? 1400 : short ? 160 : 420;
    const answer = new AnswerStream();
    let tokens = 0, lastToken = -1, lastPartial = "", lastTime = 0;
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true, skip_special_tokens: true,
      token_callback_function: value => { tokens += value.length; lastToken = Number(value.at(-1)); },
      callback_function: delta => {
        stage = "writing the answer";
        const text = answer.push(delta);
        if (text !== lastPartial && (!lastPartial || performance.now() - lastTime >= 60)) {
          post(request.requestId, { type: "partial", text, model: label });
          lastPartial = text; lastTime = performance.now();
        }
      },
    });
    // The pipeline forwards these options to model.generate; its public config
    // type omits stopping_criteria even though the installed runtime supports it.
    const generationOptions = { max_new_tokens: limit, do_sample: false, repetition_penalty: 1.08, return_full_text: false, streamer, stopping_criteria: stopping };
    const output = await generator([
      { role: "system", content: localPrompt(request.plan) },
      ...modelContext(request.history, withoutAgentSelection(request.objective), 6000),
    ], generationOptions);
    if (interrupted) return;
    recoverable = false;
    const generated = (output as Array<{ generated_text: string | Array<{ content: string }> }>)[0]?.generated_text;
    const text = finalAnswer(typeof generated === "string" ? generated : generated?.at(-1)?.content ?? "");
    const eos = generator.model.generation_config?.eos_token_id ?? generator.tokenizer.eos_token_id;
    if (tokens >= limit && !(Array.isArray(eos) ? eos : [eos]).includes(lastToken)) throw new Error("The local model reached its answer limit. Ask for a shorter answer or divide the task into parts.");
    const error = validateAnswer(text, request.plan.task);
    if (error) throw new Error(error);
    post(request.requestId, { type: "complete", text, model: label, modelId: id });
  } catch (error) {
    post(request.requestId, { type: "error", error: `${stage}: ${error instanceof Error ? error.message : String(error)}`, recoverable: recoverable && !cachedOnly });
  } finally {
    busy = false; activeRequest = "";
    if (interrupted) post(request.requestId, { type: "stopped" });
  }
});
