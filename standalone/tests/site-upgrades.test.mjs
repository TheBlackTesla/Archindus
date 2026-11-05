import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("loads browser engines only through an objective request", async () => {
  const [client, runtime, worker] = await Promise.all([
    source("app/archindus/archindus-client.tsx"), source("app/archindus/browser-runtime.ts"), source("app/archindus/engine.worker.ts"),
  ]);
  assert.match(client, /First-use download:/);
  assert.match(client, /executeObjective/);
  assert.match(runtime, /new Worker/);
  assert.match(worker, /@mlc-ai\/web-llm/);
  assert.match(worker, /enable_thinking: false/);
  assert.doesNotMatch(client, /streamQwenResponse|routeIntent/);
});

test("retains capability contracts and real artifact controls", async () => {
  const [agents, artifacts] = await Promise.all([source("app/archindus/agents.ts"), source("app/archindus/artifact-cards.tsx")]);
  assert.match(agents, /producing code is a core responsibility/);
  assert.match(artifacts, /exportDocx/);
  assert.match(artifacts, /exportPdf/);
  assert.match(artifacts, /sandbox="allow-scripts"/);
});

test("does not reconstruct framework responses", async () => {
  const worker = await source("worker/index.ts");

  assert.doesNotMatch(worker, /withSecurityHeaders/);
  assert.match(worker, /return handler\.fetch\(request, env, ctx\)/);
});
