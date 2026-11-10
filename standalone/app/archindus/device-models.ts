import { browserModelCandidates } from "./inference-policy";
import type { ModelPreference } from "./browser-runtime";
export type DeviceMode = "webgpu" | "cpu";
export type DeviceModel = { mode: DeviceMode; id: string; label: string };
export const CPU_CHAT: DeviceModel = { mode: "cpu", id: "onnx-community/Qwen2.5-0.5B-Instruct", label: "Qwen2.5 0.5B · CPU" };
export const CPU_CODER: DeviceModel = { mode: "cpu", id: "onnx-community/Qwen2.5-Coder-0.5B-Instruct", label: "Qwen2.5 Coder 0.5B · CPU" };
const gpu = [true,false].flatMap(f16 => ["auto","quality"].flatMap(pref => browserModelCandidates(pref,f16).map(m => ({mode:"webgpu" as const,id:m.id,label:m.label+" · GPU"}))));
const catalog = new Map([CPU_CHAT, CPU_CODER, ...gpu].map(m => [m.id,m]));
export const deviceModel = (id?: string) => id ? catalog.get(id) : undefined;
export const LAST_MODEL_KEY = "archindus.last-device-model.v1";
// Read only keys in the engines' existing caches. No manifests, shaders or weights fetched on startup.
export async function discoverDeviceModels(storage?: CacheStorage) {
  if (!storage) return [];
  const names = (await storage.keys()).filter(n => ["transformers-cache","webllm/model","webllm/config"].includes(n));
  const keys = await Promise.all(names.map(async n => (await (await storage.open(n)).keys()).map(r => r.url)));
  const found = new Set<DeviceModel>();
  for (const key of keys.flat()) {
    const url = new URL(key); if (url.origin !== "https://huggingface.co") continue;
    const [,owner,slug] = url.pathname.split("/");
    const m = deviceModel(owner === "mlc-ai" ? slug : owner + "/" + slug); if (m) found.add(m);
  }
  return [...found];
}
export function usableModels(models: DeviceModel[], last: string | undefined, gpu: boolean | null, f16: boolean | null) {
  return models.filter(m => m.mode === "cpu" || (gpu !== false && (f16 !== false || !m.id.includes("q4f16"))))
    .sort((a,b)=> Number(b.id===last)-Number(a.id===last) || Number(b.mode==="webgpu")-Number(a.mode==="webgpu"));
}
export function setupTarget(pref: ModelPreference, gpu: boolean, f16: boolean, models: DeviceModel[], last?: string) {
  const saved = usableModels(models,last,gpu,f16);
  if (pref === "cpu") return CPU_CHAT;
  if (["auto","small"].includes(pref) && saved.length) return saved[0];
  if (!gpu) return CPU_CHAT;
  return deviceModel(browserModelCandidates(pref,f16)[0].id)!;
}
export async function withInstallLock<T>(run: () => Promise<T>, locks?: LockManager): Promise<T> {
  if (!locks) return run();
  return locks.request("archindus-device-install",{ifAvailable:true},lock=>{
    if (!lock) throw new Error("Another Archindus tab is saving model files. Use the saved files when it finishes.");
    return run();
  });
}
