import { cacheAwareFetch, guardCacheAcquisition } from "./model-cache";
import { MLCEngine } from "@mlc-ai/web-llm";
import { preferredGpuAdapter } from "./gpu";
import { localPrompt } from "./local-model";
import { modelContext, validateAnswer, type ContextMessage } from "./answer";
import { PLAN_SCHEMA, PLANNER_PROMPT, parsePlan, type TaskPlan } from "./orchestration";
import { browserModelCandidates } from "./inference-policy";
import { AnswerStream } from "./stream";

type Request = { type: "load" | "plan" | "generate" | "stop"; requestId: string; cachedOnly?: boolean; preference?: string; modelId?: string; plan: TaskPlan; history: ContextMessage[]; objective: string };
let engine: MLCEngine | undefined;
let currentModel = "";
let modelId = "";
let busy = false;
let cachedOnly = true;
guardCacheAcquisition(typeof Cache === "undefined" ? undefined : Cache.prototype, () => cachedOnly);
self.fetch = cacheAwareFetch(self.fetch.bind(self), typeof caches === "undefined" ? undefined : caches, self.location.origin, () => cachedOnly);
let activeRequest = "";
let interrupted = false;
const post = (requestId: string, payload: Record<string, unknown>) => self.postMessage({ requestId, ...payload });

async function prepare(request: Request) {
  if (engine && modelId === request.modelId) return engine;
  if (engine) await engine.unload();
  engine = undefined;
  const adapter = await preferredGpuAdapter();
  if (!adapter) throw new Error("WebGPU is unavailable. Switching to CPU compatibility.");
  const fast = adapter.features.has("shader-f16");
  const candidates = [fast, false].flatMap(f16 => [...browserModelCandidates("quality",f16), ...browserModelCandidates("auto",f16)]);
  const sizes = [request.modelId ? candidates.find(m=>m.id===request.modelId) : browserModelCandidates(request.preference,fast)[0]].filter(m=>m!==undefined);
  let error: unknown;
  for (const candidate of sizes) {
    const model = candidate.id;
    const next = new MLCEngine({ logLevel: "ERROR", initProgressCallback: report => post(request.requestId, { type: "progress", progress: Math.round(report.progress * 100), text: "Preparing the local model · saved on this device for next time", model: `${candidate.label} · Browser GPU` }) });
    try {
      post(request.requestId, { type: "progress", text: `Preparing ${candidate.label}`, progress: 0 });
      await next.reload(model, { context_window_size: 4096 });
      engine = next;
      currentModel = `${candidate.label} · Browser GPU`;
      modelId = candidate.id;
      return next;
    } catch (cause) {
      error = cause;
      await next.unload().catch(() => {});

    }
  }
  throw error ?? new Error("No browser GPU model could be loaded.");
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "stop") {
    if (request.requestId === activeRequest) { interrupted = true; await engine?.interruptGenerate(); }
    else post(request.requestId, { type: "stopped" });
    return;
  }
  if (busy) { post(request.requestId, { type: "error", error: "A request is already running." }); return; }
  busy = true;
  cachedOnly = request.type !== "load" || request.cachedOnly !== false;
  activeRequest = request.requestId; interrupted = false;
  try {
    const runtime = await prepare(request);
    if (interrupted) return;
    if (request.type === "load") { post(request.requestId, { type: "ready", model: currentModel, modelId }); return; }
    if (request.type === "plan") {
      post(request.requestId, { type: "progress", text: "Archindus is selecting the specialist", model: currentModel });
      const result = await runtime.chat.completions.create({
        messages: [{ role: "system", content: PLANNER_PROMPT }, ...modelContext(request.history, request.objective, 4000)],
        max_tokens: 96, temperature: 0, response_format: { type: "json_object", schema: PLAN_SCHEMA }, extra_body: { enable_thinking: false },
      });
      const plan = parsePlan(result.choices[0]?.message.content ?? "", request.plan);
      if (interrupted) return;
      post(request.requestId, { type: "planned", plan, model: currentModel });
      return;
    }
    let failure = "The response was incomplete.";
    for (let attempt = 0; attempt < 2; attempt++) {
      post(request.requestId, { type: "partial", text: "" });
      post(request.requestId, { type: "progress", text: attempt ? "Completing the answer" : "Preparing the answer", model: currentModel });
      const result = await runtime.chat.completions.create({
        messages: [{ role: "system", content: `${localPrompt(request.plan)}${attempt ? "\nThe previous attempt was incomplete. Produce a more compact, complete answer with closed code fences." : ""}` }, ...modelContext(request.history, request.objective, 6000)],
        max_tokens: request.plan.task === "code" || request.plan.task === "document" ? 2048 : 420,
        temperature: request.plan.task === "code" ? 0.2 : 0.5, top_p: 0.9, extra_body: { enable_thinking: false },
        stream: true,
      });
      const answer = new AnswerStream();
      let finish = "", last = "", lastTime = 0;
      for await (const chunk of result) {
        const choice = chunk.choices[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (choice?.delta.content) {
          const partial = answer.push(choice.delta.content);
          if (partial !== last && (!last || performance.now() - lastTime >= 50)) {
            post(request.requestId, { type: "partial", text: partial, model: currentModel });
            last = partial; lastTime = performance.now();
          }
        }
      }
      const text = answer.finish();
      if (interrupted) return;
      failure = finish !== "stop" ? "The model reached its answer limit. Try a smaller task or a larger model." : validateAnswer(text, request.plan.task) ?? "";
      if (!failure) {
        // Only the checked final answer crosses the worker boundary. Raw reasoning
        // never enters React, conversation storage, exports, or the clipboard.
        post(request.requestId, { type: "complete", text, model: currentModel, modelId });
        return;
      }
    }
    throw new Error(failure);
  } catch (error) {
    post(request.requestId, { type: "error", error: error instanceof Error ? error.message : "Browser inference failed." });
  } finally { busy = false; activeRequest = ""; if (interrupted) post(request.requestId, { type: "stopped" }); }
});
