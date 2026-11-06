import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "outputs/oracle-tests.mjs");
await mkdir(path.dirname(output), { recursive: true });
await build({ stdin: { contents: ["execution", "orchestration", "image-config", "use-oracle-voice"].map(name => `export * from './app/archindus/${name}';`).join("\n"), resolveDir: root }, bundle: true, platform: "node", format: "esm", packages: "external", outfile: output, logLevel: "silent" });
const app = await import(pathToFileURL(output).href);
const fixture = new Blob(["controlled image fixture"], { type: "image/png" });

test("plural image requests invoke Ounumi sequentially and keep every result", async () => {
  const calls = [];
  let pending = 0;
  const result = await app.executeObjective("Create three images of a snowy forest", "architect", [], [], {
    modes: [], signal: new AbortController().signal, status() {},
    infer() { throw new Error("No extra classifier needed"); },
    async image(prompt) { assert.equal(pending++, 0); await Promise.resolve(); pending--; calls.push(prompt); return fixture; },
  });
  assert.equal(result.plan.primaryId, "ounumi");
  assert.equal(result.plan.task, "image");
  assert.equal(result.images.length, 3);
  assert.equal(result.image, fixture);
  assert.equal(new Set(calls).size, 3);
  assert.match(calls[0], /^a snowy forest/);
  assert.match(result.text, /3 images ready/);
});

test("large generation requests stay bounded to four independently budgeted calls", async () => {
  let calls = 0;
  const result = await app.executeObjective("Generate 30 pictures of a forest", "architect", [], [], {
    modes: [], signal: new AbortController().signal, status() {},
    async image() { calls++; return fixture; },
  });
  assert.equal(calls, 4); assert.equal(result.images.length, 4);
});

test("a failed later generation preserves completed images and makes no more calls", async () => {
  let calls = 0;
  const result = await app.executeObjective("Create 3 images of a forest", "architect", [], [], {
    modes: [], signal: new AbortController().signal, status() {},
    async image() { if (++calls === 2) throw new Error("Daily budget reached"); return fixture; },
  });
  assert.equal(calls, 2); assert.equal(result.images.length, 1);
  assert.match(result.text, /1 of 3 images ready/); assert.match(result.text, /Daily budget reached/);
});

test("stopping a batch retains finished work and stops remaining generation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await app.executeObjective("Create two images of a forest", "architect", [], [], {
    modes: [], signal: controller.signal, status() {},
    async image() { if (++calls === 2) { controller.abort(); controller.signal.throwIfAborted(); } return fixture; },
  });
  assert.equal(calls, 2); assert.equal(result.images.length, 1); assert.match(result.text, /Generation stopped/);
});

test("spoken answers discard private reasoning, code, raw URLs and Markdown", () => {
  const spoken = app.speechText('<think>secret reasoning</think>**Ready.** [Read more](https://example.com)\n```python\nprint("secret code")\n```');
  assert.doesNotMatch(spoken, /secret|https:|```|\*\*/);
  assert.match(spoken, /Ready\. Read more/);
  assert.match(spoken, /Code is available/);
});
