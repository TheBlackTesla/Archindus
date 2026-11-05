/* global tvmjs, EmccWASI, StableDiffusionPipeline */
import init, { TokenizerWasm } from "./vendor/tokenizers-wasm/tokenizers_wasm.js";

const origin = location.origin;
const base = "https://huggingface.co/mlc-ai/web-sd/resolve/c33c5ec1cfc95401dd2930972998013e978e0821/web-sd-shards-v1-5/";
let busy = false, mayDownload=false;
const network=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  if (url.origin===location.origin) return network(input,init);
  if (!url.href.startsWith(base) || !mayDownload) throw new Error("Missing saved image files. Enable the optional image download in Settings to repair them.");
  return network(input,init);
};
const send = (id, value) => parent.postMessage({ channel: "archindus-image", id, ...value }, origin);
async function bytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("A required image model file could not be downloaded. Please retry later.");
  return response.arrayBuffer();
}
window.addEventListener("message", async event => {
  if (event.origin !== origin || event.source !== parent || event.data?.channel !== "archindus-image" || busy) return;
  const { id, prompt } = event.data;
  if (typeof id !== "string" || typeof prompt !== "string" || !prompt.trim() || prompt.length > 600) return;
  busy = true; mayDownload=event.data.allowDownload===true;
  let tvm, pipeline, tokenizer, device;
  try {
    send(id, { type: "progress", text: "Checking image generation support", progress: 0 });
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" }) ?? await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("No working WebGPU adapter is available for image generation.");
    // Match the published runtime's requirements before downloading its weights.
    const requiredLimits = { maxBufferSize: 1_073_741_824, maxStorageBufferBindingSize: 1_073_741_824, maxComputeWorkgroupStorageSize: 32_768 };
    if (Object.entries(requiredLimits).some(([key, value]) => adapter.limits[key] < value)) {
      throw new Error("This GPU does not support the image model. No model files were downloaded.");
    }
    device = await adapter.requestDevice({ requiredLimits });
    // Removing the isolated engine (Stop/navigation) must release its GPU too.
    window.addEventListener("pagehide", () => device?.destroy(), { once: true });
    let deviceFailure = "";
    device.addEventListener("uncapturederror", event => {
      event.preventDefault(); deviceFailure = event.error.message;
      send(id, { type: "error", error: "Ounumi could not run the image model on this GPU. Close other GPU-heavy tabs and retry, or use a more capable computer. No image was generated." });
    });
    void device.lost.then(info => {
      if (info.reason !== "destroyed") {
        deviceFailure = "The GPU connection was lost.";
        send(id, { type: "error", error: "Ounumi lost access to this GPU. No image was generated. Please retry." });
      }
    });
    const wasm = await bytes("./vendor/stable_diffusion_webgpu.wasm");
    tvm = await tvmjs.instantiate(new Uint8Array(wasm), new EmccWASI(), () => {});
    tvm.initWebGPU(device);
    tvm.registerInitProgressCallback(report => send(id, { type: "progress", text: "Preparing the image model (first download is several GB)", progress: Math.round(report.progress * 70) }));
    await tvm.fetchNDArrayCache(base, tvm.webgpu());
    await init();
    // Keep tokenizer bytes local; no prompts are transmitted to model hosts.
    const tokenizerText = new TextDecoder().decode(await bytes("./vendor/tokenizer.json"));
    tokenizer = new TokenizerWasm(tokenizerText);
    const schedulers = await Promise.all(["scheduler_dpm_solver_multistep_consts.json", "scheduler_pndm_consts.json"].map(async path => JSON.parse(new TextDecoder().decode(await bytes("./vendor/" + path)))));
    pipeline = tvm.withNewScope(() => new StableDiffusionPipeline(tvm, tokenizer, schedulers, tvm.cacheMetadata));
    send(id, { type: "progress", text: "Preparing image shaders", progress: 72 });
    await pipeline.asyncLoadWebGPUPiplines();
    if (deviceFailure) throw new Error("This GPU could not compile the image model.");
    const pixels = await pipeline.generate(prompt, "", (stage, step, total) => send(id, { type: "progress", text: stage === "clip" ? "Preparing your image" : stage === "unet" ? `Ounumi is drawing · step ${step + 1} of ${total}` : "Finishing your image", progress: stage === "clip" ? 74 : stage === "unet" ? 75 + 23 * ((step + 1) / total) : 99 }), 0, -1, 10, true);
    await device.queue.onSubmittedWorkDone();
    if (deviceFailure) throw new Error("This GPU could not finish the image model.");
    if (!(pixels instanceof Uint8Array) || pixels.byteLength !== 512 * 512 * 4) throw new Error("The GPU did not return complete image pixels.");
    const copy = document.createElement("canvas"); copy.width = 512; copy.height = 512;
    const context = copy.getContext("2d");
    if (!context) throw new Error("This browser cannot export image pixels.");
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 512, 512), 0, 0);
    let min = 255, max = 0;
    for (let i = 0; i < pixels.length; i++) { if (i % 4 !== 3) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); } }
    if (max - min < 3) throw new Error("The GPU returned an empty image. Please try another capable device.");
    const blob = await new Promise(resolve => copy.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The image could not be exported.");
    send(id, { type: "complete", blob });
  } catch (error) {
    send(id, { type: "error", error: `Ounumi could not generate the image: ${error instanceof Error ? error.message : "This GPU could not run the model."}` });
  } finally {
    for (const release of [() => pipeline?.dispose(), () => tokenizer?.free(), () => tvm?.dispose(), () => device?.destroy()]) {
      try { release(); } catch { /* Continue releasing independent resources. */ }
    }
    busy = false; mayDownload=false;
  }
});
parent.postMessage({ channel: "archindus-image", type: "ready" }, origin);
