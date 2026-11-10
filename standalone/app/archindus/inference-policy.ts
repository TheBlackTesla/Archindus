import type { EngineMode } from "./execution";

/** Automatic local attempts must run with BrowserRuntime.cachedOnly enabled. */
export function inferenceModes(deviceOnly: boolean, qwenOnline: boolean, gpuAvailable: boolean | null, readyMode?: "webgpu" | "cpu"): EngineMode[] {
  if (deviceOnly) return gpuAvailable === false ? ["cpu"] : ["webgpu", "cpu"];
  // The endpoint owns cooldown/accounting; fallback may reuse only saved files.
  const online: EngineMode[] = qwenOnline ? ["qwen", "hosted"] : ["hosted"];
  const local: EngineMode[] = gpuAvailable === false ? ["cpu"] : ["webgpu", "cpu"];
  return readyMode && local.includes(readyMode)
    ? [readyMode, ...online, ...local.filter(mode => mode !== readyMode)]
    : [...online, ...local];
}

export function browserModelSizes(preference?: string) {
  return preference === "quality" ? ["4B", "1.7B", "0.6B"] : preference === "balanced" ? ["1.7B", "0.6B"] : ["0.6B"];
}

/** Non-thinking fast model first; retain Qwen3 as a cached compatibility option. */
export function browserModelCandidates(preference: string | undefined, f16: boolean) {
  const quant = f16 ? "q4f16_1" : "q4f32_1";
  const qwen3 = browserModelSizes(preference).map(size => ({ id: `Qwen3-${size}-${quant}-MLC`, label: `Qwen3 ${size}` }));
  return preference === "balanced" || preference === "quality" ? qwen3
    : [{ id: `Qwen2.5-0.5B-Instruct-${quant}-MLC`, label: "Qwen2.5 0.5B" }, ...qwen3];
}
