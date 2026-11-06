import type { ContextMessage } from "./answer";
import { transportHistory } from "./answer";
import type { AgentId } from "./agents";
import type { TaskPlan } from "./orchestration";
import { requestId } from "./request-id";
import { validateGeneratedImage } from "./image-output";
import { readEvents } from "./stream";

export class HostedRefusal extends Error { name = "HostedRefusal"; }
export class HostedRuntime {
  temporary = false;
  personalityId?:string;
  onModel?:(model:string)=>void;
  private unavailableUntil = 0;
  constructor(private transport: typeof fetch = fetch.bind(globalThis), private now: () => number = Date.now) {}
  // One explicit user retry may recheck the server after local backoff.
  // Server-side cooldown, quota and budget checks remain authoritative.
  beginUserRequest(){this.unavailableUntil=0;}
  async request(action: "plan" | "generate" | "image", selected: AgentId, objective: string, history: ContextMessage[], signal: AbortSignal, plan?: TaskPlan, onPartial?: (text: string) => void) {
    signal.throwIfAborted();
    if (this.now() < this.unavailableUntil) throw new Error("Hosted inference is temporarily unavailable.");
    let retryAfter = 60;
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
      const response = await this.transport("/api/archindus/hosted", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: requestSignal,
        body: JSON.stringify({ requestId: requestId(), action, stream: action === "generate", temporary:this.temporary,...(this.personalityId?{personalityId:this.personalityId}:{}), selectedAgentId: selected, objective, history: transportHistory(history), ...(plan ? { plan: { primaryId: plan.primaryId, task: plan.task } } : {}) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.code === "content_refused") throw new HostedRefusal(data.error);
        if(response.status===404&&this.personalityId){const e=new Error(data.error);e.name='PersonalityUnavailable';throw e;}
        const seconds = Number(response.headers.get("Retry-After"));
        if (Number.isFinite(seconds) && seconds > 0) retryAfter = Math.min(300, Math.max(60, seconds));
        throw new Error(data.error ?? "Hosted inference is unavailable.");
      }
      if (action === "image") {
        const image = await response.blob();
        await validateGeneratedImage(image, 1024);
        return { image, model: "GPT Image mini · Hosted" };
      }
      if (response.headers.get("Content-Type")?.includes("text/event-stream") && response.body) {
        for await (const event of readEvents(response.body, requestSignal)) {
          if(typeof event.model==='string')this.onModel?.(event.model);
          if (event.type === "error") {
            if (event.code === "content_refused") throw new HostedRefusal(event.error);
            throw new Error(event.error ?? "The answer was interrupted.");
          }
          if (event.type === "partial" && typeof event.text === "string") onPartial?.(event.text);
          if (event.type === "complete" && typeof event.text === "string") return { text: event.text, model: event.model as string };
        }
        throw new Error("The answer was interrupted. Please retry.");
      }
      return await response.json() as { plan?: TaskPlan; text?: string; model?: string };
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof HostedRefusal)&&!(error instanceof Error&&error.name==='PersonalityUnavailable')) this.unavailableUntil = this.now() + retryAfter * 1000;
      throw error;
    }
  }
}

export async function imageWithFallback(hosted: (() => Promise<{ image: Blob; model: string }>) | undefined, local: () => Promise<Blob>, signal: AbortSignal) {
  signal.throwIfAborted();
  if (hosted) {
    try { const result = await hosted(); signal.throwIfAborted(); return result; }
    catch (error) { signal.throwIfAborted(); if (error instanceof HostedRefusal || error instanceof Error&&error.name==='PersonalityUnavailable') throw error; }
  }
  const image = await local(); signal.throwIfAborted();
  return { image, model: "Stable Diffusion · Browser GPU" };
}
