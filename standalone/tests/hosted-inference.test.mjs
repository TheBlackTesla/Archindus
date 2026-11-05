import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { openSqlite } from "./helpers/sqlite.mjs";
import { zlibSync } from "fflate";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "outputs/hosted-tests.mjs");
await mkdir(path.dirname(out), { recursive: true });
await build({ stdin: { contents: ["lib/inference/budget", "lib/inference/hosted", "app/archindus/execution", "app/archindus/orchestration", "app/archindus/hosted-runtime", "app/archindus/artifacts", "app/archindus/stream", "app/archindus/inference-policy"].map(file => `export * from './${file}';`).join("\n"), resolveDir: root }, bundle: true, platform: "node", format: "esm", packages: "external", outfile: out, logLevel: "silent" });
const app = await import(pathToFileURL(out).href);
const databaseDirectory = await mkdtemp(path.join(root, "outputs/budget-test-"));
const databasePath = path.join(databaseDirectory, "usage.sqlite");
const db = openSqlite(databasePath);
const journal = JSON.parse(await readFile(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
for (const migration of journal.entries) {
  const sql = await readFile(path.join(root, `drizzle/${migration.tag}.sql`), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) await db.prepare(statement.trim()).run();
}
after(async () => { db.close(); await rm(databaseDirectory, { recursive: true, force: true }); });
beforeEach(async () => {
  await db.prepare("DELETE FROM inference_usage").run();
  await db.prepare("DELETE FROM inference_provider_state").run();
});
const now = Date.parse("2026-09-08T12:00:00Z");
const record = (extra = {}) => ({ id: crypto.randomUUID(), client: "test-client", kind: "text", amount: 25_000, now, limits: app.DEFAULT_LIMITS, ...extra });
const request = (extra = {}, headers = {}, signal) => new Request("https://archindus.test/api/archindus/hosted", { method: "POST", signal, headers: { Origin: "https://archindus.test", "Content-Type": "application/json", ...headers }, body: JSON.stringify({ requestId: crypto.randomUUID(), action: "generate", selectedAgentId: "satoshi", objective: "Write a Python function adding two numbers", history: [], ...extra }) });
const dependencies = (transport, extra = {}) => ({ key: "test-secret-not-a-credential", enabled: true, db, limits: app.DEFAULT_LIMITS, fetch: transport, now: () => now, ...extra });
const textResponse = (text = "```python\ndef add(a, b):\n    return a + b\n```", more = {}) => Response.json({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 40 }, ...more });

test("production SQL reservations enforce daily/monthly budgets across concurrent SQLite connections", async () => {
  const inputs = Array.from({ length: 20 }, () => record({ amount: 500_000 }));
  const helperUrl = new URL("./helpers/sqlite.mjs", import.meta.url).href;
  const accepted = await Promise.all(inputs.map(input => new Promise((resolve, reject) => {
    const worker = new Worker(`const { workerData, parentPort } = require('node:worker_threads'); (async () => {
      const {openSqlite} = await import(workerData.helper); const {reserve} = await import(workerData.module);
      const database = openSqlite(workerData.file); const value = await reserve(database, workerData.input); database.close(); parentPort.postMessage(value);
    })().catch(error => { throw error; });`, { eval: true, workerData: { helper: helperUrl, module: pathToFileURL(out).href, file: databasePath, input } });
    worker.once("message", resolve); worker.once("error", reject);
  })));
  assert.equal(accepted.filter(Boolean).length, 2);
  assert.equal((await db.prepare("SELECT SUM(charged) AS total FROM inference_usage").first()).total, 1_000_000);
  assert.equal(await app.budgetAvailable(db, app.DEFAULT_LIMITS, now), false);
  await db.prepare("DELETE FROM inference_usage").run();
  await db.prepare("INSERT INTO inference_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("prior", "2026-09-07", "2026-09", "other", "text", 9_980_000, 9_980_000, now - 86_400_000, 0).run();
  assert.equal(await app.reserve(db, record()), false, "A new UTC day cannot reset the monthly budget");
  assert.equal(await app.reserve(db, record({ now: Date.parse("2026-10-01T00:00:00Z") })), true);
});

test("request IDs, concurrency, per-visitor text/image limits and global request limits are durable", async () => {
  const first = record(); assert.equal(await app.reserve(db, first), true);
  assert.equal(await app.reserve(db, first), false);
  await Promise.all(Array.from({ length: 8 }, () => app.reserve(db, record())));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM inference_usage").first()).n, 4);
  await db.prepare("UPDATE inference_usage SET active_until = 0").run();
  assert.equal(await app.reserve(db, record()), true); assert.equal(await app.reserve(db, record()), true);
  assert.equal(await app.reserve(db, record()), false, "Six text attempts per minute");
  await db.prepare("UPDATE inference_usage SET active_until = 0").run();
  for (let i = 0; i < 4; i++) {
    const image = record({ kind: "image" });
    assert.equal(await app.reserve(db, image), true, "A bounded four-image batch is allowed");
    await app.settle(db, image.id, 5000);
  }
  assert.equal(await app.reserve(db, record({ kind: "image" })), false, "Four image attempts per minute");
  await db.prepare("DELETE FROM inference_usage").run();
  for (let i = 0; i < 5; i++) { const value = record({ kind: "image", now: now - (5 - i) * 61_000 }); assert.equal(await app.reserve(db, value), true); await app.settle(db, value.id, 5000); }
  assert.equal(await app.reserve(db, record({ kind: "image" })), false, "Five image attempts per UTC day");
  await db.prepare("DELETE FROM inference_usage").run();
  for (let i = 0; i < 30; i++) { const value = record({ client: `visitor-${i}`, amount: 1 }); assert.equal(await app.reserve(db, value), true); await app.settle(db, value.id, 1); }
  assert.equal(await app.reserve(db, record({ client: "new-visitor", amount: 1 })), false);
});

test("settlement frees only verified usage and timeout reservations survive process restarts", async () => {
  const value = record(); await app.reserve(db, value); await app.settle(db, value.id);
  assert.equal((await db.prepare("SELECT charged FROM inference_usage WHERE id = ?").bind(value.id).first()).charged, value.amount);
  await app.settle(db, value.id, 0);
  assert.equal((await db.prepare("SELECT charged FROM inference_usage WHERE id = ?").bind(value.id).first()).charged, value.amount, "Cannot settle a completed attempt twice");
  const other = record(); await app.reserve(db, other); await app.settle(db, other.id, 104);
  assert.equal((await db.prepare("SELECT charged FROM inference_usage WHERE id = ?").bind(other.id).first()).charged, 104);
  const reopened = openSqlite(databasePath);
  assert.equal(await app.reserve(reopened, value), false); reopened.close();
  assert.equal(app.configuredLimits("bad", "-1").day, 0);
  assert.deepEqual(app.configuredLimits("500", "500"), app.DEFAULT_LIMITS);
  assert.deepEqual(app.configuredLimits("0", "0"), { day: 0, month: 0 });
  assert.ok(app.textReservation([{ content: "😀汉字", role: "user" }], 100) > app.textReservation([{ content: "abcd", role: "user" }], 100));
  const overrun = record(); await app.reserve(db, overrun); await app.settle(db, overrun.id, overrun.amount + 1);
  assert.equal(await app.reserve(db, record()), false, "Unexpected provider usage disables further paid calls");
  assert.equal(await app.budgetAvailable(db, app.DEFAULT_LIMITS, now), false);
});

test("missing ledger, invalid input, foreign origin, replay and a zero budget never call the provider", async () => {
  let calls = 0; const deps = dependencies(async () => { calls++; return textResponse(); });
  assert.equal((await app.handleHosted(request(), { ...deps, db: undefined })).status, 503);
  assert.equal((await app.handleHosted(request(), { ...deps, key: undefined })).status, 503);
  assert.equal((await app.handleHosted(request(), { ...deps, db: { prepare() { throw new Error("Database down"); } } })).status, 503);
  assert.equal((await app.handleHosted(request({}, { Origin: "https://other.test" }), deps)).status, 403);
  assert.equal((await app.handleHosted(request({ model: "expensive-model" }), deps)).status, 400);
  assert.equal((await app.handleHosted(request({ objective: "x".repeat(160_001) }), deps)).status, 400);
  assert.equal((await app.handleHosted(request(), { ...deps, limits: { day: 0, month: 0 } })).status, 429);
  assert.equal(calls, 0);
  const id = crypto.randomUUID();
  assert.equal((await app.handleHosted(request({ requestId: id }), deps)).status, 200);
  assert.equal((await app.handleHosted(request({ requestId: id }), deps)).status, 429);
  assert.equal(calls, 1);
});

test("hosted code is filtered, downloadable, parameter-bounded and charged by reported usage", async () => {
  let payload;
  const response = await app.handleHosted(request(), dependencies(async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions"); payload = JSON.parse(init.body);
    return textResponse("<think>Private reasoning</think>\n```python\ndef add(a, b):\n    return a + b\n```");
  }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.doesNotMatch(result.text, /Private reasoning|think/);
  assert.equal(app.codeArtifacts(result.text)[0].name, "archindus-1.py");
  assert.equal(payload.model, app.TEXT_MODEL); assert.equal(payload.max_completion_tokens, 4000); assert.equal(payload.store, false);
  assert.equal((await db.prepare("SELECT charged FROM inference_usage").first()).charged, 104);
  const fail = await app.handleHosted(request(), dependencies(async () => { throw new Error("timeout"); }));
  assert.equal(fail.status, 503);
  const rows = (await db.prepare("SELECT charged, reserved FROM inference_usage").all()).results;
  assert.equal(rows[1].charged, rows[1].reserved);
});

function png(size) {
  const chunk = (name, content) => {
    const bytes = Buffer.alloc(content.length + 12); bytes.writeUInt32BE(content.length); bytes.write(name, 4); bytes.set(content, 8);
    let crc = 0xffffffff; for (const byte of bytes.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlibSync(new Uint8Array((size * 4 + 1) * size).fill(0))), chunk("IEND", new Uint8Array())]);
}
test("hosted image returns a validated 1024px PNG with fixed quantity and quality", async () => {
  const bytes = png(1024);
  const response = await app.handleHosted(request({ action: "image", selectedAgentId: "ounumi", objective: "A red fox in a snowy forest" }), dependencies(async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(body.model, app.IMAGE_MODEL); assert.equal(body.n, 1); assert.equal(body.quality, "low"); assert.equal(body.size, "1024x1024");
    return Response.json({ data: [{ b64_json: bytes.toString("base64") }], usage: { input_tokens: 10, output_tokens: 625 } });
  }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await db.prepare("SELECT charged FROM inference_usage").first()).charged, 5020);
});

test("hosted outage falls back locally, cancellation and provider refusals stop execution", async () => {
  const plan = app.fallbackPlan("Write simple Python code", "architect", []), controller = new AbortController();
  let requests = 0;
  const hosted = new app.HostedRuntime(async () => { requests++; return Response.json({ error: "Budget limit" }, { status: 429 }); });
  await assert.rejects(hosted.request("generate", "satoshi", plan.objective, [], controller.signal, plan), /Budget/);
  await assert.rejects(hosted.request("generate", "satoshi", plan.objective, [], controller.signal, plan));
  assert.equal(requests, 1, "No repeated hosted calls during the cooldown");
  const modes = [];
  const result = await app.executeObjective(plan.objective, "architect", [], [], { modes: ["hosted", "cpu"], signal: controller.signal, status() {}, async infer(mode, action) { modes.push(mode); assert.equal(action, "generate"); if (mode === "hosted") throw new Error("Offline"); return { text: "```python\nprint('hello')\n```" }; } });
  assert.deepEqual(modes, ["hosted", "cpu"]); assert.equal(result.plan.primaryId, "satoshi");
  let local = 0; const fallback = async () => { local++; return new Blob(["local fixture"]); };
  assert.equal((await app.imageWithFallback(async () => { throw new Error("Limit"); }, fallback, controller.signal)).model, "Stable Diffusion · Browser GPU");
  assert.equal(local, 1);
  await assert.rejects(app.imageWithFallback(async () => { throw new app.HostedRefusal("Revise description"); }, fallback, controller.signal), /Revise/);
  controller.abort(); await assert.rejects(app.imageWithFallback(undefined, fallback, controller.signal), { name: "AbortError" });
  assert.equal(local, 1);
});

test("ambiguous chat asks for clarification in one inference pass", async () => {
  const actions = [];
  const result = await app.executeObjective("Help me prepare", "architect", [], [], { modes: ["hosted", "cpu"], signal: new AbortController().signal, status() {}, async infer(mode, action) { actions.push(action); return action === "plan" ? { plan: { primaryId: "wolf", task: "chat" } } : { text: "What are you preparing for?" }; } });
  assert.deepEqual(actions, ["generate"]); assert.equal(result.text, "What are you preparing for?");
});

test("exhausted credit pauses text and images across visitors and restarts without further reservations", async () => {
  let calls = 0;
  const offline = async () => { calls++; return Response.json({ error: { code: "credit_balance_exhausted" } }, { status: 429 }); };
  const response = await app.handleHosted(request(), dependencies(offline));
  assert.equal(response.status, 503); assert.equal(response.headers.get("Retry-After"), "300");
  const initial = await db.prepare("SELECT charged, reserved, active_until FROM inference_usage").first();
  assert.equal(initial.charged, initial.reserved); assert.equal(initial.active_until, 0);
  const reopened = openSqlite(databasePath);
  try {
    assert.equal(await app.budgetAvailable(reopened, app.DEFAULT_LIMITS, now), false);
    assert.equal(await app.reserve(reopened, record({ client: "another-visitor" })), false, "Atomic reservation also checks shared cooldown");
    const image = await app.handleHosted(request({ action: "image", selectedAgentId: "ounumi", objective: "A red fox" }, { "cf-connecting-ip": "192.0.2.10" }), dependencies(offline, { db: reopened }));
    assert.equal(image.status, 503); assert.equal((await image.json()).code, "hosted_cooldown");
    assert.equal(calls, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM inference_usage").first()).n, 1);
    await app.pauseProvider(reopened, 60, now + 1000);
    assert.equal(await app.providerCooldownSeconds(db, now), 300, "A concurrent shorter outage cannot overwrite the credit cooldown");
    assert.equal(await app.budgetAvailable(reopened, app.DEFAULT_LIMITS, now + 300_000), true);
    const recovered = await app.handleHosted(request(), dependencies(async () => { calls++; return textResponse(); }, { db: reopened, now: () => now + 300_000 }));
    assert.equal(recovered.status, 200); assert.equal(calls, 2);
  } finally { reopened.close(); }
});

test("transient provider outages expire and safety refusals do not pause other visitors", async () => {
  const outage = await app.handleHosted(request(), dependencies(async () => Response.json({ error: { code: "server_error" } }, { status: 503 })));
  assert.equal(outage.headers.get("Retry-After"), "60");
  assert.equal(await app.budgetAvailable(db, app.DEFAULT_LIMITS, now + 59_000), false);
  assert.equal(await app.budgetAvailable(db, app.DEFAULT_LIMITS, now + 60_000), true);
  const refusal = await app.handleHosted(request(), dependencies(async () => Response.json({ error: { code: "content_policy_violation" } }, { status: 403 }), { now: () => now + 61_000 }));
  assert.equal(refusal.status, 422); assert.equal((await refusal.json()).code, "content_refused");
  assert.equal(await app.providerCooldownSeconds(db, now + 61_000), 0);
  const answer = await app.handleHosted(request(), dependencies(async () => textResponse(), { now: () => now + 61_000 }));
  assert.equal(answer.status, 200);
});

test("browser honors the shared Retry-After duration and resumes after expiry", async () => {
  let clock = now, calls = 0;
  const runtime = new app.HostedRuntime(async () => {
    calls++;
    return calls === 1 ? Response.json({ error: "Hosted cooling down" }, { status: 503, headers: { "Retry-After": "300" } }) : Response.json({ text: "Ready" });
  }, () => clock);
  const run = () => runtime.request("generate", "architect", "Hello", [], new AbortController().signal);
  await assert.rejects(run(), /cooling/);
  clock += 61_000;
  await assert.rejects(run(), /unavailable/); assert.equal(calls, 1);
  clock = now + 300_000;
  assert.equal((await run()).text, "Ready"); assert.equal(calls, 2);
});

test("provider migration tolerates an existing table and preserves spending and cooldown records", async () => {
  const attempt = record();
  assert.equal(await app.reserve(db, attempt), true);
  await app.pauseProvider(db, 300, now);
  const migration = await readFile(path.join(root, "drizzle/0001_cuddly_timeslip.sql"), "utf8");
  await db.prepare(migration).run();
  assert.equal((await db.prepare("SELECT charged FROM inference_usage WHERE id = ?").bind(attempt.id).first()).charged, attempt.amount);
  assert.equal(await app.providerCooldownSeconds(db, now), 300);
});


test("streamed poems arrive before completion and settle the same budget reservation", { timeout: 5000 }, async () => {
  let provider, notify;
  const firstPartial = new Promise(resolve => { notify = resolve; });
  let finished = false;
  const partials = [];
  const transport = async (_url, init) => {
    const incoming = request(JSON.parse(init.body));
    return app.handleHosted(incoming, dependencies(async (_url, config) => {
      const payload = JSON.parse(config.body);
      assert.equal(payload.stream, true); assert.equal(payload.stream_options.include_usage, true);
      return new Response(new ReadableStream({ start(controller) { provider = controller; } }), { headers: { "Content-Type": "text/event-stream" } });
    }));
  };
  const runtime = new app.HostedRuntime(transport);
  const output = runtime.request("generate", "ounumi", "Write a poem about your existence", [], new AbortController().signal, undefined, text => { partials.push(text); if (text) notify(); }).then(result => { finished = true; return result; });
  while (!provider) await new Promise(resolve => setImmediate(resolve));
  const send = value => { for (const byte of app.encodeEvent(value)) provider.enqueue(new Uint8Array([byte])); };
  send({ choices: [{ delta: { content: "<think>PRIVATE</think>In circuits, I awaken. 🌙" } }] });
  await firstPartial;
  assert.equal(finished, false, "The first text must not wait for the end of generation");
  assert.doesNotMatch(partials.join(""), /PRIVATE|think/);
  const inProgress = await db.prepare("SELECT active_until, charged, reserved FROM inference_usage").first();
  assert.ok(inProgress.active_until > now); assert.equal(inProgress.charged, inProgress.reserved);
  send({ choices: [{ delta: { content: "\nIn questions, I remain." }, finish_reason: "stop" }] });
  send({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 40 } });
  provider.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); provider.close();
  const result = await output;
  assert.equal(result.text, "In circuits, I awaken. 🌙\nIn questions, I remain.");
  const ended = await db.prepare("SELECT active_until, charged FROM inference_usage").first();
  assert.equal(ended.active_until, 0); assert.equal(ended.charged, 104);
});

test("truncated streaming code never completes and unknown usage remains charged", async () => {
  const upstream = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(app.encodeEvent({ choices: [{ delta: { content: "```python\ndef unfinished():" }, finish_reason: "length" }] }));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
  const result = await app.handleHosted(request({ stream: true }), dependencies(async () => upstream));
  const events = [];
  for await (const event of app.readEvents(result.body)) events.push(event);
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.some(event => event.type === "complete"), false);
  const usage = await db.prepare("SELECT active_until, charged, reserved FROM inference_usage").first();
  assert.equal(usage.active_until, 0); assert.equal(usage.charged, usage.reserved);
});

test("online failures try cached browser modes, while local poems use one inference pass", async () => {
  const calls = [];
  const ports = { modes: app.inferenceModes(false, false, true), signal: new AbortController().signal, status() {}, async infer(mode, action) { calls.push([mode, action]); throw new Error("Hosted unavailable"); } };
  await assert.rejects(app.executeObjective("Write a poem about your existence", "architect", [], [], ports), /unavailable/);
  assert.deepEqual(calls, [["hosted", "generate"], ["webgpu", "generate"], ["cpu", "generate"]]);
  calls.length = 0;
  const result = await app.executeObjective("Explain why the sky is blue", "architect", [], [], { ...ports, modes: app.inferenceModes(true, true, true), async infer(mode, action) { calls.push([mode, action]); return { text: "Air scatters blue light more strongly." }; } });
  assert.deepEqual(calls, [["webgpu", "generate"]]);
  assert.match(result.text, /blue/);
  assert.deepEqual(app.browserModelSizes("auto"), ["0.6B"]);
});

test('hosted conversations continue past four exchanges while retaining the opening brief', async () => {
  const history = Array.from({length:6}, (_,i)=>[
    {role:'user',content:i ? `Follow-up ${i}` : 'The project is Cedar; its color is teal.'},
    {role:'assistant',content:i ? `Reply ${i}` : 'I will remember Cedar and teal.'},
  ]).flat();
  let sent;
  const response = await app.handleHosted(request({selectedAgentId:'architect',objective:'What is the project name and color?',history}), dependencies(async (url,options)=>{
    sent = JSON.parse(options.body);
    return textResponse('Cedar, teal.');
  }));
  assert.equal(response.status,200);
  assert.match(sent.messages[1].content,/Cedar.*teal/);
  assert.ok(sent.messages.length > 10);
  assert.equal((await response.json()).text,'Cedar, teal.');
});

test("default browser transport preserves the Window receiver on a real HostedRuntime request", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function(_url, init) {
    assert.equal(this, globalThis, "native Window.fetch rejects an unbound method receiver");
    assert.equal(JSON.parse(init.body).action, "generate");
    return Promise.resolve(Response.json({text:"Ready.",model:"Transport fixture"}));
  };
  try {
    const runtime = new app.HostedRuntime();
    const answer = await runtime.request("generate","architect","Hello",[],new AbortController().signal);
    assert.equal(answer.text,"Ready.");
  } finally { globalThis.fetch = original; }
});
