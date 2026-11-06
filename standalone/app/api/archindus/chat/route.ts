import { streamedCompletion } from "../../../../lib/inference/stream";
import { z } from "zod";
import { AGENTS, getAgentPrompt, type AgentId } from "../../../archindus/agents";
import { finalAnswer, formatAnswer, modelContext, validateAnswer } from "../../../archindus/answer";
import { fallbackPlan, parsePlan, PLANNER_PROMPT, PLAN_SCHEMA, taskInstructions } from "../../../archindus/orchestration";

const schema = z.object({
  stream: z.boolean().optional(),
  action: z.enum(["plan", "generate"]),
  selectedAgentId: z.string().max(30),
  objective: z.string().min(1).max(16_000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16_000), agentId: z.string().optional(), status: z.string().optional(), objective: z.string().max(3500).optional() })).max(40),
  plan: z.object({ primaryId: z.string().max(30), task: z.enum(["chat", "code", "document", "analysis", "image", "video"]) }).optional(),
});
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "This request must come from Archindus." }, 403);
  const endpoint = process.env.ARCHINDUS_QWEN_ENDPOINT?.trim();
  if (!endpoint) return json({ error: "The private runtime is not connected." }, 503);
  let input;
  try {
    const body = await request.text();
    if (body.length > 150_000) return json({ error: "The request is too large." }, 413);
    input = schema.parse(JSON.parse(body));
  } catch { return json({ error: "Invalid request." }, 400); }
  if (!AGENTS.some(a => a.id === input.selectedAgentId) || (input.plan && !AGENTS.some(a => a.id === input.plan!.primaryId))) return json({ error: "Unknown agent." }, 400);
  let plan = fallbackPlan(input.objective, input.selectedAgentId as AgentId, input.history);
  if (input.plan) plan = parsePlan(JSON.stringify({ agentId: input.plan.primaryId, task: input.plan.task }), plan);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.ARCHINDUS_QWEN_API_KEY?.trim()) headers.Authorization = `Bearer ${process.env.ARCHINDUS_QWEN_API_KEY.trim()}`;
  try {
    const streaming = input.action === "generate" && input.stream === true;
    const controller=new AbortController();
    const signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(120_000)]);
    const result = await fetch(new URL("chat/completions", endpoint.endsWith("/") ? endpoint : endpoint + "/"), {
      method: "POST", headers, signal,
      body: JSON.stringify({
        model: process.env.ARCHINDUS_QWEN_MODEL?.trim() || "Qwen/Qwen3.8-27B",
        messages: [{ role: "system", content: input.action === "plan" ? `${PLANNER_PROMPT}\nJSON schema: ${PLAN_SCHEMA}` : `${getAgentPrompt(plan.primaryId)}\n${taskInstructions(plan)}` }, ...modelContext(input.history, input.objective, 12_000)],
        stream: streaming, max_tokens: input.action === "plan" ? 128 : plan.task === "code" || plan.task === "document" ? 3000 : 1600,
        temperature: input.action === "plan" ? 0 : 0.4,
        ...(input.action === "plan" ? { response_format: { type: "json_object" } } : {}),
        chat_template_kwargs: { enable_thinking: false, preserve_thinking: false },
      }),
    });
    if (!result.ok) return json({ error: "The private runtime is unavailable. Trying browser inference." }, 503);
    if (streaming && result.headers.get("Content-Type")?.includes("text/event-stream")) {
      return streamedCompletion(result,{signal,cancel:()=>controller.abort(),task:plan.task,model:process.env.ARCHINDUS_QWEN_MODEL?.trim()||"Private Qwen",settle:async()=>{}});
    }
    const output = await result.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    const choice = output.choices?.[0];
    if (input.action === "plan") return json({ plan: parsePlan(choice?.message?.content ?? "", plan), model: "Private Qwen" });
    const text = formatAnswer(choice?.message?.content ?? "",plan.task);
    const error = choice?.finish_reason === "length" ? "The private model reached its answer limit." : validateAnswer(text, plan.task);
    if (error) return json({ error }, 502);
    return json({ text, model: process.env.ARCHINDUS_QWEN_MODEL?.trim() || "Private Qwen" });
  } catch { return json({ error: "The private runtime could not complete this request." }, 503); }
}
