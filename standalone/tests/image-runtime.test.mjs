import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { zlibSync } from "fflate";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "outputs/behavioral/image-runtime.mjs");
await mkdir(path.dirname(output), { recursive: true });
await build({ stdin: { contents: "export * from './app/archindus/image-runtime'; export * from './app/archindus/image-output';", resolveDir: root }, bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" });
const { ImageRuntime, validateGeneratedImage } = await import(pathToFileURL(output).href);

// A synthetic PNG fixture exercises file delivery; it is not a model output.
function pngFixture() {
  const chunk = (kind, data) => {
    const value = Buffer.alloc(12 + data.length);
    value.writeUInt32BE(data.length); value.write(kind, 4); value.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of value.subarray(4, -4)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    value.writeUInt32BE((crc ^ 0xffffffff) >>> 0, value.length - 4);
    return value;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(512); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 6;
  const rows = new Uint8Array((512 * 4 + 1) * 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = y * (512 * 4 + 1) + 1 + x * 4;
    rows[i] = x % 256; rows[i + 1] = y % 256; rows[i + 2] = 128; rows[i + 3] = 255;
  }
  return new Blob([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlibSync(rows)), chunk("IEND", new Uint8Array())], { type: "image/png" });
}

test("PNG output rejects spoofed types, truncated files, and corrupted pixels", async () => {
  const png = pngFixture();
  await validateGeneratedImage(png);
  await assert.rejects(validateGeneratedImage(new Blob(["not a png".repeat(30)], { type: "image/png" })), /not a PNG/);
  await assert.rejects(validateGeneratedImage(png.slice(0, -12, "image/png")), /incomplete/);
  const bytes = new Uint8Array(await png.arrayBuffer()); bytes[50] ^= 1;
  await assert.rejects(validateGeneratedImage(new Blob([bytes], { type: "image/png" })), /corrupted/);
});

test("image lifecycle isolates messages, accepts checked PNGs, cancels, and recovers", async t => {
  const names = ["window", "location", "document", "navigator"];
  const descriptors = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { for (const name of names) { if (descriptors[name]) Object.defineProperty(globalThis, name, descriptors[name]); else delete globalThis[name]; } });
  const window = new EventTarget(), origin = "https://archindus.test";
  let created, frame, adapter = { limits: { maxBufferSize: 1_073_741_824, maxStorageBufferBindingSize: 1_073_741_824, maxComputeWorkgroupStorageSize: 32_768 } };
  const requests = [];
  let createdPromise = new Promise(resolve => { created = resolve; });
  const document = {
    createElement() { frame = { contentWindow: { postMessage(data) { frame.request = data; } }, remove() { this.removed = true; } }; return frame; },
    body: { appendChild(value) { created(value); } },
  };
  const values = { window, document, location: { origin }, navigator: { gpu: { async requestAdapter(options) { requests.push(options); return adapter; } } } };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: values[name] });
  const send = (data, source = frame.contentWindow, from = origin) => {
    const event = new Event("message"); Object.assign(event, { source, origin: from, data: { channel: "archindus-image", ...data } }); window.dispatchEvent(event);
  };
  const reports = [], runtime = new ImageRuntime((...args) => reports.push(args));
  const pending = runtime.generate("a city", new AbortController().signal);
  await createdPromise;
  assert.deepEqual(requests[0], { powerPreference: "high-performance" });
  send({ type: "ready" }, {}, origin); assert.equal(frame.request, undefined);
  send({ type: "ready" }, frame.contentWindow, "https://other.test"); assert.equal(frame.request, undefined);
  send({ type: "ready" }); const id = frame.request.id; assert.equal(frame.request.allowDownload,false);
  send({ type: "progress", id: "stale", text: "wrong", progress: 50 }); assert.equal(reports.length, 0);
  send({ type: "progress", id, text: "drawing", progress: 50 }); assert.equal(reports[0][1], 50);
  const png = pngFixture(); send({ type: "complete", id, blob: png });
  assert.equal(await pending, png); assert.equal(frame.removed, true);

  createdPromise = new Promise(resolve => { created = resolve; });
  const controller = new AbortController();
  const stopped = runtime.generate("another city", controller.signal);
  const rejection = assert.rejects(stopped, { name: "AbortError" });
  await createdPromise; controller.abort(); await rejection; assert.equal(frame.removed, true);

  createdPromise = new Promise(resolve => { created = resolve; });
  const failed = runtime.generate("retry", new AbortController().signal);
  const bootFailure = assert.rejects(failed, /could not load/);
  await createdPromise; send({ type: "boot-error" }); await bootFailure; assert.equal(frame.removed, true);
  const previousFrame = frame;
  adapter = { limits: { maxBufferSize: 268_435_456, maxStorageBufferBindingSize: 134_217_728, maxComputeWorkgroupStorageSize: 16_384 } };
  await assert.rejects(runtime.generate("image", new AbortController().signal), /No model files were downloaded/);
  assert.equal(frame, previousFrame, "An unsupported GPU must not start the model frame");
  adapter = null;
  await assert.rejects(runtime.generate("image", new AbortController().signal), /no image was generated/);
});

test("diffusion stops when shards cannot be retained instead of repeatedly downloading them", async () => {
  const source = await readFile(path.join(root, "public/media/vendor/tvmjs.bundle.js"), "utf8");
  for (const [cache, expectedDownloads] of [[undefined, 0], [{async open(){throw new Error("denied")}},0], [{async open(){return {async match(){},async put(){throw new Error("quota")}}}},1]]) {
    let fetched = 0;
    const context = { exports: {}, module: {}, Request, Response, URL, TextEncoder, TextDecoder, performance, caches: cache, async fetch() { fetched++; return new Response("model bytes"); } };
    runInNewContext(source, context);
    const artifactCache = new context.exports.ArtifactCache("test");
    await assert.rejects(artifactCache.fetchWithCache("https://models.test/shard.bin"), /storage is unavailable or full/);
    assert.equal(fetched, expectedDownloads);
  }
});

test("the actual diffusion WASM and CLIP tokenizer initialize and execute", async () => {
  // Use the same constructors across the VM boundary: TVM checks instanceof.
  // This runs real WASM operations, but does not stand in for GPU diffusion.
  const context = { exports: {}, module: { exports: {} }, WebAssembly, Function, Array, ArrayBuffer, Float32Array, Int32Array, Uint8Array, TextDecoder, TextEncoder, performance, console, crypto, URL, Request, Response, setTimeout, clearTimeout };
  runInNewContext(await readFile(path.join(root, "public/media/vendor/tvmjs.bundle.js"), "utf8"), context);
  runInNewContext(await readFile(path.join(root, "public/media/vendor/tvmjs_runtime.wasi.js"), "utf8"), context);
  const tvm = await context.exports.instantiate(new Uint8Array(await readFile(path.join(root, "public/media/vendor/stable_diffusion_webgpu.wasm"))), new context.EmccWASI(), () => {});
  try {
    tvm.withNewScope(() => {
      const array = tvm.empty([3], "float32", tvm.cpu()).copyFrom([1, 2, 3]);
      assert.deepEqual(Array.from(array.toArray()), [1, 2, 3]);
    });
  } finally { tvm.dispose(); }
  const { default: init, TokenizerWasm } = await import(pathToFileURL(path.join(root, "public/media/vendor/tokenizers-wasm/tokenizers_wasm.js")).href);
  await init(await readFile(path.join(root, "public/media/vendor/tokenizers-wasm/tokenizers_wasm_bg.wasm")));
  const tokenizer = new TokenizerWasm(await readFile(path.join(root, "public/media/vendor/tokenizer.json"), "utf8"));
  try {
    const encoded = tokenizer.encode("A red fox in a snowy forest", true);
    try { assert.deepEqual(Array.from(encoded.input_ids), [49406, 320, 736, 3240, 530, 320, 14191, 4167, 49407]); }
    finally { encoded.free(); }
  } finally { tokenizer.free(); }
});
