import { requestId } from "./request-id";
import { preferredGpuAdapter, imageGpuIssue } from "./gpu";
import { validateGeneratedImage } from "./image-output";
/** Isolated document for the original MLC canvas runtime; removing it stops all work. */
export class ImageRuntime {
  private frame?: HTMLIFrameElement;
  private reject?: (error: Error) => void;
  constructor(private report: (text: string, progress: number) => void) {}
  cancel() { this.reject?.(new DOMException("Stopped", "AbortError")); this.frame?.remove(); this.frame = undefined; }
  async generate(prompt: string, signal: AbortSignal, allowDownload=false): Promise<Blob> {
    signal.throwIfAborted();
    if (!prompt.trim() || prompt.length > 600) throw new Error("Please describe the image in 600 characters or fewer.");
    const adapter = await preferredGpuAdapter();
    signal.throwIfAborted();
    if (!adapter) throw new Error("Ounumi needs a browser with a working WebGPU adapter to generate images. This device cannot run the image model; no image was generated.");
    const issue = imageGpuIssue(adapter.limits);
    if (issue) throw new Error(issue);
    // MLC's float32 SD 1.5 runtime needs roughly 7 GB working GPU memory.
    // Limits cannot measure free VRAM, so allocation failures still surface honestly.
    this.cancel();
    return new Promise((resolve, reject) => {
      const id = requestId();
      const frame = document.createElement("iframe"); this.frame = frame;
      frame.hidden = true; frame.title = "Ounumi image generation engine";
      let settled = false, started = false, validating = false;
      const cleanup = () => { window.removeEventListener("message", onMessage); signal.removeEventListener("abort", onAbort); clearTimeout(timer); clearTimeout(startupTimer); this.reject = undefined; frame.remove(); if (this.frame === frame) this.frame = undefined; };
      const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
      const onAbort = () => fail(new DOMException("Stopped", "AbortError"));
      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== "archindus-image") return;
        const value = event.data;
        if (settled) return;
        if (value.type === "boot-error") { fail(new Error("Ounumi's image engine could not load. Please retry on a compatible browser.")); return; }
        if (value.type === "ready") { if (!started) { started = true; clearTimeout(startupTimer); frame.contentWindow?.postMessage({ channel: "archindus-image", id, prompt, allowDownload }, location.origin); } return; }
        if (value.id !== id) return;
        if (value.type === "progress") this.report(String(value.text), Math.min(100, Math.max(0, Number(value.progress) || 0)));
        if (value.type === "error") fail(new Error(value.error || "The image model could not run on this GPU. No image was generated."));
        if (value.type === "complete" && !validating) {
          validating = true;
          void validateGeneratedImage(value.blob).then(() => {
            if (settled) return;
            settled = true; cleanup(); resolve(value.blob);
          }).catch(fail);
        }
      };
      const startupTimer = setTimeout(() => fail(new Error("Ounumi's image engine did not finish loading. Please retry.")), 30_000);
      const timer = setTimeout(() => fail(new Error("Image generation exceeded ten minutes. The initial model download is several GB; retry on a capable computer and a faster connection.")), 600_000);
      this.reject = fail; window.addEventListener("message", onMessage); signal.addEventListener("abort", onAbort, { once: true });
      frame.onerror = () => fail(new Error("Ounumi's image engine could not be loaded. Please retry."));
      frame.src = "/media/engine.html"; document.body.appendChild(frame);
    });
  }
}
