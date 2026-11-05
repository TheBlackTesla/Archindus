import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
const out = new URL("../outputs/stream-tests.mjs", import.meta.url);
await mkdir(new URL("../outputs", import.meta.url), { recursive: true });
await build({ entryPoints: [new URL("../app/archindus/stream.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", outfile: out.pathname, logLevel: "silent" });
const { AnswerStream, readEvents, encodeEvent } = await import(out.href);

test("reasoning tags stay hidden at every possible token boundary", () => {
  for (const input of ["<think>PRIVATE</think>Final", "&lt;think&gt;PRIVATE&lt;/think&gt;Final", "\\<think>PRIVATE\\</think>Final", "<analysis>PRIVATE</analysis>Final"]) {
    const filter = new AnswerStream();
    for (const character of input) assert.doesNotMatch(filter.push(character), /PRIVATE|think|analysis|&lt|&gt/);
    assert.equal(filter.finish(), "Final");
  }
  const reasoning = new AnswerStream(true);
  for (const character of "PRIVATE</think>Final") assert.doesNotMatch(reasoning.push(character), /PRIVATE|think/);
  assert.equal(reasoning.finish(), "Final");
});

test("an aborted stream cancels its reader, including while waiting for data", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(encodeEvent({ text: "First" })); }, cancel() { cancelled = true; } });
  const abort = new AbortController();
  const iterator = readEvents(body, abort.signal);
  assert.equal((await iterator.next()).value.text, "First");
  const waiting = iterator.next(); abort.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(cancelled, true);
});
