import { requestId as makeRequestId } from "./request-id";
import type { ContextMessage } from "./answer";
import type { TaskPlan } from "./orchestration";

export type ModelPreference = "auto" | "small" | "balanced" | "quality" | "cpu";
export type RuntimeReport = { type: string; requestId?: string; text?: string; progress?: number; model?: string; modelId?: string; plan?: TaskPlan; error?: string; recoverable?: boolean };
class RuntimeFailure extends Error {}
export class BrowserRuntime {
  private gpu?: Worker;
  private cpu?: Worker;
  private pending = new Set<(reason: Error) => void>();
  private failedGpuPreference?: string;
  private stopping = new Map<Worker, { done: Promise<void>; finish: (discard?: boolean) => void }>();
  preference: ModelPreference = "auto";
  modelId?: string;
  cachedOnly = true;
  readyMode?: "webgpu" | "cpu";
  constructor(private report: (value: RuntimeReport) => void) {}
  cancel() {
    this.readyMode = undefined;
    for (const reject of [...this.pending]) reject(new DOMException("Stopped", "AbortError"));
    for (const stop of [...this.stopping.values()]) stop.finish(true);
    this.gpu?.terminate(); this.cpu?.terminate(); this.gpu = undefined; this.cpu = undefined;
  }
  resetFailures() { this.failedGpuPreference = undefined; }
  releaseGpu() { if (this.readyMode === "webgpu") this.readyMode = undefined; this.gpu?.terminate(); this.gpu = undefined; }
  private stopWorker(worker: Worker, requestId: string) {
    let resolve!: () => void;
    let finished = false;
    const done = new Promise<void>(value => { resolve = value; });
    const finish = (discard = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); worker.removeEventListener("message", stopped); worker.removeEventListener("error", failed); worker.removeEventListener("messageerror", failed);
      this.stopping.delete(worker);
      if (discard) {
        worker.terminate();
        if (this.gpu === worker) this.gpu = undefined;
        if (this.cpu === worker) this.cpu = undefined;
      }
      resolve();
    };
    const stopped = (event: MessageEvent<RuntimeReport>) => {
      if (event.data.requestId === requestId && ["stopped", "complete", "ready", "error"].includes(event.data.type)) finish(event.data.type === "error");
    };
    const failed = () => finish(true);
    const timer = setTimeout(failed, 8000);
    this.stopping.set(worker, { done, finish });
    worker.addEventListener("message", stopped); worker.addEventListener("error", failed); worker.addEventListener("messageerror", failed);
    try { worker.postMessage({ type: "stop", requestId }); } catch { failed(); }
  }
  async request(mode: "webgpu" | "cpu", type: "load" | "plan" | "generate", plan: TaskPlan, history: ContextMessage[], objective: string, signal: AbortSignal, onPartial?: (text: string) => void): Promise<RuntimeReport> {
    const waiting = this.stopping.get(mode === "webgpu" ? this.gpu! : this.cpu!);
    if (waiting) await new Promise<void>((resolve, reject) => {
      const aborted = () => { signal.removeEventListener("abort", aborted); reject(new DOMException("Stopped", "AbortError")); };
      if (signal.aborted) { aborted(); return; }
      signal.addEventListener("abort", aborted, { once: true });
      void waiting.done.then(() => { signal.removeEventListener("abort", aborted); resolve(); });
    });
    try { return await this.run(mode, type, plan, history, objective, signal, onPartial); }
    catch (error) {
      if (type === "load" || mode !== "cpu" || signal.aborted || !(error instanceof RuntimeFailure)) throw error;
      onPartial?.("");
      this.report({ type: "progress", text: "Recovering the local model · your conversation is retained" });
      return this.run(mode, type, plan, history, objective, signal, onPartial);
    }
  }
  private run(mode: "webgpu" | "cpu", type: "load" | "plan" | "generate", plan: TaskPlan, history: ContextMessage[], objective: string, signal: AbortSignal, onPartial?: (text: string) => void) {
    if (signal.aborted) return Promise.reject(new DOMException("Stopped", "AbortError"));
    const gpuAttempt = `${this.modelId ?? this.preference}:${this.cachedOnly}`;
    if (mode === "webgpu" && this.failedGpuPreference === gpuAttempt) return Promise.reject(new Error("Using CPU compatibility after the GPU model failed."));
    const worker = mode === "webgpu"
      ? this.gpu ??= new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" })
      : this.cpu ??= new Worker(new URL("./cpu.worker.ts", import.meta.url), { type: "module" });
    const requestId = makeRequestId();
    return new Promise<RuntimeReport>((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer); clearTimeout(idleTimer); worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); worker.removeEventListener("messageerror", onError); signal.removeEventListener("abort", onAbort); this.pending.delete(fail);
      };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const reset = (error: Error) => {
        if (this.readyMode === mode) this.readyMode = undefined;
        if (mode === "webgpu") { this.failedGpuPreference = gpuAttempt; this.gpu = undefined; }
        else this.cpu = undefined;
        worker.terminate(); fail(error);
      };
      const heartbeat = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => reset(new RuntimeFailure("The browser model stopped responding. Please retry.")), 90_000); };
      const onAbort = () => {
        if (type === "load") {worker.terminate(); if (this.gpu===worker) this.gpu=undefined; if (this.cpu===worker) this.cpu=undefined; if(this.readyMode===mode)this.readyMode=undefined;}
        else this.stopWorker(worker,requestId);
        fail(new DOMException("Stopped","AbortError"));
      };
      const onError = () => reset(new RuntimeFailure("The browser model stopped unexpectedly. Please retry."));
      const onMessage = (event: MessageEvent<RuntimeReport>) => {
        const data = event.data;
        if (data.requestId !== requestId) return;
        if (data.type === "error") { reset(data.recoverable ? new RuntimeFailure(data.error ?? "Inference failed.") : new Error(data.error ?? "Inference failed.")); return; }
        heartbeat();
        if (data.type === "partial" && typeof data.text === "string") onPartial?.(data.text);
        this.report(data);
        if (["ready", "planned", "complete"].includes(data.type)) { this.readyMode = mode; cleanup(); resolve(data); }
      };
      const timer = setTimeout(() => reset(new Error("This request exceeded five minutes. Try a shorter task.")), 300_000);
      this.pending.add(fail); worker.addEventListener("message", onMessage); worker.addEventListener("error", onError); worker.addEventListener("messageerror", onError); signal.addEventListener("abort", onAbort, { once: true });
      heartbeat();
      try { worker.postMessage({ type, requestId, plan, history, objective, preference: this.preference, modelId: this.modelId, cachedOnly: type !== "load" || this.cachedOnly }); }
      catch { onError(); }
    });
  }
}
