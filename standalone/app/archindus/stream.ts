import { finalAnswer } from "./answer";

/** SSE frames can split anywhere, including UTF-8 characters and tag boundaries. */
export async function* readEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2_000_000) throw new Error("Response exceeds the streaming limit.");
      buffer += decoder.decode(part.value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        yield JSON.parse(data);
      }
    }
    if (buffer.trim()) throw new Error("The response stream ended unexpectedly.");
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const encodeEvent = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);

/** Thinking models with an implicit opening tag require boundaryRequired=true.
 * WebLLM non-thinking mode prefills a complete empty think block (0.2.84).
 */
export class AnswerStream {
  private raw = "";
  constructor(private boundaryRequired = false) {}
  push(delta: string) {
    this.raw += delta;
    if (this.raw.length > 100_000) throw new Error("Answer is too long.");
    if (this.boundaryRequired && !/<\/(?:think|analysis|reasoning)>/i.test(this.raw)) return "";
    const safe = this.raw.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/(?:\\?<[^>]*|&(?:l(?:t)?|g(?:t)?)?)$/i, "");
    return finalAnswer(safe);
  }
  finish() { return finalAnswer(this.raw); }
}
