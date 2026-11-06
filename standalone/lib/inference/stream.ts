import { AnswerStream, encodeEvent, readEvents } from "../../app/archindus/stream";
import { validateAnswer,formatAnswer } from "../../app/archindus/answer";
import { textUsageCost } from './models';

export function streamedCompletion(response: Response, options: {
  signal: AbortSignal; cancel: () => void; task: string; model: string;
  settle: (actual?: number) => Promise<void>;
  rates?: {input:number;output:number;cached?:number};
}) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let actual: number | undefined;
      let completed: Record<string, unknown>;
      const send = (value: unknown) => { if (!cancelled) controller.enqueue(encodeEvent(value)); };
      try {
        if (!response.body) throw new Error("Missing response stream");
        const answer = new AnswerStream();
        let finish = "", last = "", lastTime = 0;
        for await (const data of readEvents(response.body, options.signal)) {
          if (data.error) throw new Error("Upstream stream failed");
          if (data.usage && Number.isSafeInteger(data.usage.prompt_tokens) && data.usage.prompt_tokens > 0 && Number.isSafeInteger(data.usage.completion_tokens) && data.usage.completion_tokens >= 0) {
            actual = options.rates ? textUsageCost(data.usage,options.rates) : Math.ceil(data.usage.prompt_tokens * 0.4 + data.usage.completion_tokens * 1.6);
          }
          const choice = data.choices?.[0];
          if (choice?.delta?.refusal || choice?.finish_reason === "content_filter") {
            const refused = new Error("Please revise your request."); refused.name = "HostedRefusal"; throw refused;
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (typeof choice?.delta?.content === "string") {
            const text = answer.push(choice.delta.content);
            if (text !== last && (!last || Date.now() - lastTime >= 45)) {
              send({ type: "partial", text, model: options.model }); last = text; lastTime = Date.now();
            }
          }
        }
        options.signal.throwIfAborted();
        const text = finish==='stop'?formatAnswer(answer.finish(),options.task):answer.finish();
        if (finish !== "stop" || validateAnswer(text, options.task)) throw new Error("Incomplete answer");
        completed = { type: "complete", text, model: options.model };
      } catch (error) {
        completed = { type: "error", code: error instanceof Error && error.name === "HostedRefusal" ? "content_refused" : "incomplete_stream", error: "The answer was interrupted. Please retry." };
      }
      // Keep the reservation alive through the stream. A missing usage event
      // retains the full amount, including after cancellation or a disconnect.
      try { await options.settle(actual); } catch { console.warn("Streaming inference reservation retained"); }
      if (!cancelled) { send(completed); controller.close(); }
    },
    cancel() { cancelled = true; options.cancel(); },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" } });
}
