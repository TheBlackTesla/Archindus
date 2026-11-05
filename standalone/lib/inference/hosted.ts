import { z } from "zod";
import { AGENTS, getAgentPrompt, type AgentId } from "../../app/archindus/agents";
import { finalAnswer, modelContext, validateAnswer } from "../../app/archindus/answer";
import { fallbackPlan, parsePlan, PLANNER_PROMPT, PLAN_SCHEMA, taskInstructions } from "../../app/archindus/orchestration";
import { validateGeneratedImage } from "../../app/archindus/image-output";
import { clientKey, pauseProvider, providerCooldownSeconds, reserve, settle, type Limits, type UsageDb } from "./budget";
import { streamedCompletion } from "./stream";

// Fixed models/parameters: request bodies cannot select a more expensive model,
// change resolution/quality, invoke tools, or increase the output allowance.
export const TEXT_MODEL = "gpt-4.1-mini-2025-04-14";
export const IMAGE_MODEL = "gpt-image-1-mini";
const utf8 = (text: string) => new TextEncoder().encode(text).length;
type Message = { role: string; content: string };
export const textReservation = (messages: Message[], output: number) => Math.ceil((messages.reduce((sum, m) => sum + utf8(m.content) + 32, 256)) * 0.4 + output * 1.6);
export const imageReservation = (prompt: string) => 20_000 + (utf8(prompt) + 256) * 2;

const schema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["plan", "generate", "image"]),
  stream: z.boolean().optional(),
  selectedAgentId: z.string().max(30),
  objective: z.string().trim().min(1).max(16_000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16_000), agentId: z.string().max(30).optional(), status: z.string().max(30).optional(), objective: z.string().max(3500).optional() })).max(40).default([]),
  plan: z.object({ primaryId: z.string().max(30), task: z.enum(["chat", "code", "document", "analysis", "image", "video"]) }).optional(),
}).strict();
const json = (value: unknown, status = 200, retryAfter?: number) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
async function boundedJson(request: Request | Response, max: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty body");
  const decoder = new TextDecoder(); let bytes = 0, text = "";
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > max) { await reader.cancel(); throw new Error("Body limit"); }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
export type HostedDependencies = { key?: string; enabled: boolean; db?: UsageDb; limits: Limits; fetch?: typeof fetch; now?: () => number };
export async function handleHosted(request: Request, deps: HostedDependencies) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Send this request from Archindus." }, 403);
  if (!deps.enabled || !deps.key || !deps.db) return json({ error: "Hosted inference is unavailable. Trying local inference." }, 503);
  let input;
  try { input = schema.parse(await boundedJson(request, 150_000)); }
  catch { return json({ error: "Invalid or oversized request." }, 400); }
  if (!AGENTS.some(a => a.id === input.selectedAgentId) || (input.plan && !AGENTS.some(a => a.id === input.plan!.primaryId))) return json({ error: "Unknown agent." }, 400);
  if (input.action === "image" && input.objective.length > 2400) return json({ error: "Use an image description under 2,400 characters." }, 400);
  let plan = fallbackPlan(input.objective, input.selectedAgentId as AgentId, input.history);
  if (input.plan) plan = parsePlan(JSON.stringify({ agentId: input.plan.primaryId, task: input.plan.task }), plan);
  const planning = input.action === "plan", image = input.action === "image";
  const outputLimit = planning ? 160 : ["code", "document"].includes(plan.task) ? 4000 : 1200;
  const messages = [{ role: "system", content: planning ? `${PLANNER_PROMPT}\nJSON schema: ${PLAN_SCHEMA}` : `${getAgentPrompt(plan.primaryId)}\n${taskInstructions(plan)}` }, ...modelContext(input.history, input.objective, 12_000)];
  const amount = image ? imageReservation(input.objective) : textReservation(messages, outputLimit);
  const now = deps.now?.() ?? Date.now();
  try {
    request.signal.throwIfAborted();
    const client = await clientKey(request, deps.key, new Date(now).toISOString().slice(0, 10));
    if (!await reserve(deps.db, { id: input.requestId, client, kind: image ? "image" : "text", amount, now, limits: deps.limits })) {
      // reserve checks cooldown atomically; explain a rejection only on failure.
    const retryAfter = await providerCooldownSeconds(deps.db, now);
    if (retryAfter) return json({ error: "Hosted inference is temporarily unavailable. Trying local inference.", code: "hosted_cooldown" }, 503, retryAfter);
      return json({ error: "Hosted capacity or spending limit reached.", code: "hosted_limit" },429);
    }
  } catch { return json({ error: "Hosted cost controls are unavailable. Trying local inference." }, 503); }

  let actual: number | undefined;
  let streamOwnsSettlement = false;
  const upstream = new AbortController();
  const streaming = input.stream === true && !planning && !image;
  const signal = AbortSignal.any([request.signal, upstream.signal, AbortSignal.timeout(image ? 110_000 : 35_000)]);
  try {
    request.signal.throwIfAborted();
    const response = await (deps.fetch ?? fetch)(`https://api.openai.com/v1/${image ? "images/generations" : "chat/completions"}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${deps.key}` },
      signal,
      body: JSON.stringify(image ? { model: IMAGE_MODEL, prompt: input.objective, n: 1, size: "1024x1024", quality: "low", output_format: "png" } : {
        model: TEXT_MODEL, messages, max_completion_tokens: outputLimit, temperature: planning ? 0 : 0.4, stream: streaming, store: false,
        ...(streaming ? { stream_options: { include_usage: true } } : {}),
        ...(planning ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!response.ok) {
      const error = await boundedJson(response, 32_000).catch(() => null);
      // Respect a provider safety refusal; never route it to another generator.
      const code = error?.error?.code;
      if (["content_policy_violation", "moderation_blocked", "safety_violations"].includes(code) || /safety|content policy|moderation/i.test(error?.error?.message ?? "")) return json({ error: "This request could not be generated. Please revise the description.", code: "content_refused" }, 422);
      const accountUnavailable = [401, 402, 403].includes(response.status) || ["credit_balance_exhausted", "insufficient_quota", "billing_hard_limit_reached", "invalid_api_key"].includes(code);
      const retryAfter = accountUnavailable ? 300 : response.status === 408 || response.status === 429 || response.status >= 500 ? 60 : 0;
      if (retryAfter) await pauseProvider(deps.db, retryAfter, deps.now?.() ?? Date.now());
      console.warn("Hosted inference unavailable", { status: response.status, kind: image ? "image" : "text", code: typeof code === "string" ? code.slice(0, 80) : "upstream" });
      return json({ error: "Hosted inference is temporarily unavailable. Trying local inference.", code: "hosted_unavailable" }, 503, retryAfter);
    }
    if (streaming && response.headers.get("Content-Type")?.includes("text/event-stream")) {
      streamOwnsSettlement = true;
      return streamedCompletion(response, { signal, cancel: () => upstream.abort(), task: plan.task, model: "Hosted GPT-4.1 mini", settle: actual => settle(deps.db!, input.requestId, actual) });
    }
    const data = await boundedJson(response, image ? 14_000_000 : 200_000);
    if (image) {
      const encoded = data.data?.[0]?.b64_json;
      if (typeof encoded !== "string" || encoded.length > 13_400_000) throw new Error("Missing image");
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      await validateGeneratedImage(blob, 1024);
      const usage = data.usage;
      if (Number.isSafeInteger(usage?.input_tokens) && usage.input_tokens >= 0 && Number.isSafeInteger(usage?.output_tokens) && usage.output_tokens > 0) actual = Math.ceil(usage.input_tokens * 2 + usage.output_tokens * 8);
      return new Response(blob, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Disposition": 'inline; filename="ounumi.png"', "X-Content-Type-Options": "nosniff", "X-Archindus-Model": IMAGE_MODEL } });
    }
    const usage = data.usage;
    if (Number.isSafeInteger(usage?.prompt_tokens) && usage.prompt_tokens > 0 && Number.isSafeInteger(usage?.completion_tokens) && usage.completion_tokens >= 0) actual = Math.ceil(usage.prompt_tokens * 0.4 + usage.completion_tokens * 1.6);
    const choice = data.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") return json({ error: "This request could not be completed. Please revise it.", code: "content_refused" }, 422);
    if (choice?.finish_reason !== "stop" || typeof choice?.message?.content !== "string") throw new Error("Incomplete answer");
    if (planning) return json({ plan: parsePlan(choice.message.content, plan), model: "Hosted GPT-4.1 mini" });
    const text = finalAnswer(choice.message.content);
    if (validateAnswer(text, plan.task)) throw new Error("Invalid answer");
    return json({ text, model: "Hosted GPT-4.1 mini" });
  } catch { return json({ error: "Hosted inference could not complete the request. Trying local inference." }, 503); }
  finally {
    try { if (!streamOwnsSettlement) await settle(deps.db, input.requestId, actual); }
    catch { console.warn("Inference reservation retained after accounting failure"); }
  }
}
