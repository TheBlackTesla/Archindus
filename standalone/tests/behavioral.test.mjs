import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "outputs/behavioral");
await mkdir(output, { recursive: true });
await build({ stdin: { contents: ["agents", "answer", "orchestration", "artifacts", "execution", "document-tools", "image-config"].map(name => `export * from './app/archindus/${name}';`).join("\n"), resolveDir: root }, bundle: true, platform: "node", format: "esm", packages: "external", outfile: path.join(output, "modules.mjs"), logLevel: "silent" });
const app = await import(pathToFileURL(path.join(output, "modules.mjs")).href);
const signal = () => new AbortController().signal;
const history = [{ role: "user", content: "Create an image of yourself" }, { role: "assistant", agentId: "ounumi", content: "Which style?", status: "complete" }];

test("explicit selection wins; follow-ups preserve the task; quoted names are data", () => {
  for (const input of ["Use Ounumi Agent", "I told you, use Ounumi", "Ounumi, create a portrait", "Use Plor Agent", "Use Angelu Agent"]) {
    const plan = app.fallbackPlan(input, "architect", history);
    assert.equal(plan.primaryId, "ounumi");
    assert.equal(plan.task, "image");
    assert.equal(app.parsePlan('{"agentId":"socrates","task":"chat"}', plan).primaryId, "ounumi");
  }
  assert.equal(app.fallbackPlan("write a Python function", "wolf", []).primaryId, "wolf");
  assert.equal(app.explicitAgent('Explain the phrase "Use Ounumi Agent"'), undefined);
  assert.equal(app.explicitAgent("Do not use Ounumi"), undefined);
  assert.equal(app.explicitAgent("Do not use Angelu"), undefined);
  assert.equal(app.getAgent("angelu").name, "Ounumi");
  assert.equal(app.getAgent("plor").name, "Ounumi");
  assert.equal(app.explicitAgent("Do not use Plor"), undefined);
  assert.equal(app.fallbackPlan("Write a poem", "plor", []).primaryId, "ounumi");
  assert.equal(app.fallbackPlan("Continue", "architect", [{ role: "user", content: "Write a poem" }, { role: "assistant", agentId: "angelu", content: "A poem" }]).primaryId, "ounumi");
  assert.equal(app.fallbackPlan("Hi", "architect", []).primaryId, "architect");
  assert.equal(app.fallbackPlan("Can you make an image?", "architect", []).task, "image");
  assert.equal(app.fallbackPlan("Create Python code that generates an image", "architect", []).task, "code");
  assert.throws(() => app.parsePlan('{"agentId":"invented","task":"chat"}', app.fallbackPlan("Help", "architect", [])));
});

test("private reasoning never becomes answer text, history, or an exported artifact", () => {
  for (const raw of ["<think>SECRET</think>Final", "SECRET</think>Final", "\\<think>SECRET\\</think>Final", "&lt;think&gt;SECRET&lt;/think&gt;Final", "<analysis>SECRET</analysis>Final", "Final<think>SECRET", "Final<thi"]) {
    assert.equal(app.finalAnswer(raw), "Final");
  }
  const raw = "<think>SECRET</think>```python\nprint(42)\n```";
  assert.equal(app.codeArtifacts(raw)[0].content, "print(42)");
  assert.ok(!JSON.stringify(app.cleanHistory([{ role: "assistant", content: raw }])).includes("SECRET"));
  assert.equal(app.cleanHistory([{ role: "assistant", content: "I don't have the ability to write code." }]).length, 0);
  assert.ok(app.validateAnswer("```html\n<!doctype html><html>unfinished\n```", "code"));
  assert.ok(app.validateAnswer("```python\nprint(1)", "code"));
});

test("indented code responses produce downloadable source files", () => {
  const text = "Here is the function:\n\n  ```python filename=addition.py\n  def add(a, b):\n      return a + b\n  ```";
  assert.equal(app.validateAnswer(text, "code"), null);
  const files = app.codeArtifacts(text);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "addition.py");
  assert.equal(files[0].content, "def add(a, b):\n    return a + b");
  const codeOnly = text.slice(text.indexOf("  ```")).replace(/\n/g, "\r\n");
  assert.equal(app.codeArtifacts(codeOnly)[0].content, files[0].content);
});

test("Ounumi separates new creative tasks from image follow-ups", async () => {
  const failedImage = [{ role: "user", content: "Create an image of a fox" }, { role: "assistant", agentId: "ounumi", status: "error", objective: "Create an image of a fox", content: "GPU unavailable" }];
  for (const prompt of ["Use Ounumi Agent. Write a two-line poem about a quiet forest.", "Ask Ounumi to write a poem", "Ounumi, create a short story", "Create a storyboard for a video of a forest"]) {
    const plan = app.fallbackPlan(prompt, "architect", failedImage);
    assert.equal(plan.primaryId, "ounumi");
    assert.equal(plan.task, "chat");
    assert.equal(plan.objective, prompt);
  }
  const result = await app.executeObjective("Use Ounumi Agent. Write a poem.", "architect", failedImage, [], {
    modes: ["cpu"], signal: signal(), status() {},
    async infer(mode, action, plan, objective, context) { assert.equal(plan.task, "chat"); assert.deepEqual(context, []); return { text: "Trees hold the morning light.\nThe forest wakes in green." }; },
    image() { throw new Error("A poem must not invoke diffusion"); },
  });
  assert.match(result.text, /Trees/);
  const followup = app.fallbackPlan("Make it watercolor", "architect", failedImage);
  assert.equal(followup.task, "image"); assert.match(followup.objective, /fox/);
  assert.equal(app.fallbackPlan("Use Angelu Agent", "architect", failedImage).task, "image");
  for (const prompt of ["Draw a red fox", "Paint a snowy forest", "Ounumi, sketch a robot", "Illustrate a mountain"]) {
    assert.equal(app.fallbackPlan(prompt, "architect", []).task, "image");
  }
  for (const prompt of ["Draw a conclusion from this argument", "Write an image prompt for a forest", "Write a script for a video of a fox"]) assert.equal(app.taskKind(prompt), "chat");
  assert.equal(app.imagePrompt("Draw a red fox. Use Ounumi Agent"), "red fox");
  assert.equal(app.imagePrompt("Draw a red fox. Use Plor Agent"), "red fox");
  assert.equal(app.imagePrompt("Ounumi, create a logo"), null);
  const clarification = [{ role: "user", content: "Can you make an image?" }, { role: "assistant", agentId: "ounumi", content: "What would you like the image to show?" }];
  assert.equal(app.fallbackPlan("Use Ounumi. A red fox", "architect", clarification).objective, "Create an image of A red fox");
  assert.equal(app.fallbackPlan("Use Ounumi. Write a poem", "architect", clarification).task, "chat");
});

test("greetings and agent questions avoid inference entirely", async () => {
  const ports = { modes: ["webgpu", "cpu"], signal: signal(), status() {}, infer() { throw new Error("Should not load a model"); }, image() { throw new Error("Should not load media"); } };
  const greeting = await app.executeObjective("Hi", "architect", [], [], ports);
  assert.equal(greeting.plan.primaryId, "architect");
  assert.ok(greeting.text.length < 150);
  const capability = await app.executeObjective("Which agent can code?", "architect", [], [], ports);
  assert.match(capability.text, /Satoshi writes/);
});

test("clear coding requests skip planning and recovery preserves the specialist", async () => {
  const calls = [];
  const result = await app.executeObjective("I need simple snake code", "architect", [], [], {
    modes: ["webgpu", "cpu"], signal: signal(), status() {},
    async infer(mode, action, plan) {
      calls.push([mode, action, plan.primaryId]);
      if (action === "plan") return { plan: { primaryId: "socrates", task: "chat" } };
      if (mode === "webgpu") return { text: "I cannot write code." };
      return { text: "```html\n<!doctype html><html><body>Example</body></html>\n```", model: "test executor" };
    }, image() { throw new Error("Wrong executor"); },
  });
  assert.equal(result.plan.primaryId, "satoshi");
  assert.deepEqual(calls.map(c => c[1]), ["generate", "generate"]);
  assert.ok(calls.filter(c => c[1] === "generate").every(c => c[2] === "satoshi"));
  assert.equal(app.codeArtifacts(result.text)[0].name, "archindus-1.html");
  // This validates routing/recovery with controlled executors, not model quality.
});

test("Ounumi invokes media, never claims an image when generation fails", async () => {
  let called = 0;
  const ports = { modes: [], signal: signal(), status() {}, infer() { throw new Error("Wrong executor"); }, async image(prompt) { called++; assert.match(prompt, /imagined AI/); throw new Error("GPU unavailable"); } };
  const question = await app.executeObjective("Can you make an image?", "architect", [], [], ports);
  assert.equal(question.plan.primaryId, "ounumi"); assert.equal(called, 0);
  await assert.rejects(app.executeObjective("Create an image of yourself. Use Ounumi Agent", "architect", [], [], ports), /GPU unavailable/);
  assert.equal(called, 1);
  const video = await app.executeObjective("Create a video of a city", "architect", [], [], ports);
  assert.match(video.text, /Video generation is not connected/);
});

test("image details after a clarification reach Ounumi without a text-model download", async () => {
  let received;
  const image = new Blob(["controlled executor fixture"], { type: "image/png" });
  const context = [{ role: "user", content: "Can you make an image?" }, { role: "assistant", agentId: "ounumi", objective: "Can you make an image?", content: "What would you like the image to show? You can include a style, or let Ounumi choose one." }];
  const result = await app.executeObjective("A fox in a snowy forest", "architect", context, [], {
    modes: ["cpu"], signal: signal(), status() {}, infer() { throw new Error("Must not use a text model"); },
    async image(prompt) { received = prompt; return image; },
  });
  assert.equal(result.plan.primaryId, "ounumi"); assert.equal(result.image, image);
  assert.equal(received, "A fox in a snowy forest");
  assert.equal(app.imagePrompt("Ounumi, create an image of a blue city"), "a blue city");
  assert.equal(app.imagePrompt("Create an image of a blue city. Use Angelu Agent"), "a blue city");
  assert.match(app.imagePrompt("Create an image of yourself. Use Ounumi Agent"), /portrait of Ounumi/);
  const failed = [...context, { role: "user", content: "A fox in a snowy forest" }, { role: "assistant", agentId: "ounumi", status: "error", objective: "Create an image of A fox in a snowy forest", content: "GPU unavailable" }];
  const retry = app.fallbackPlan("Use Angelu Agent", "architect", failed);
  assert.equal(retry.primaryId, "ounumi"); assert.equal(retry.task, "image");
  assert.match(retry.objective, /fox/);
});

test("CSV statistics use actual rows and reject malformed or incomplete data", async () => {
  const file = { id: "fixture", name: "metrics.csv", text: 'name,value\n"Alpha, one",10\nBeta,20\nGamma,\n', truncated: false };
  const result = await app.executeObjective("Summarize the statistics", "architect", [], [file], { modes: [], signal: signal(), status() {}, infer() { throw new Error("No LLM needed"); } });
  assert.match(result.text, /\| value \| 2 \| 1 \| 30 \| 15 \| 15 \| 10 \| 20 \|/);
  assert.throws(() => app.summarizeCsv('x,y\n1,2,3'), /column counts/);
  assert.throws(() => app.parseCsv('x\n"oops'), /unclosed/);
  const truncated = await app.executeObjective("Summarize the statistics", "architect", [], [{ ...file, truncated: true }], { modes: [], signal: signal(), status() {} });
  assert.match(truncated.text, /Upload a smaller CSV/);
});

test("text uploads validate limits and JSON before entering context", async () => {
  const file = new File(["Plan: build, test, deliver."], "notes.txt");
  assert.equal((await app.readAttachment(file)).text, "Plan: build, test, deliver.");
  await assert.rejects(app.readAttachment(new File(["oops"], "invalid.json")), /not valid JSON/);
  await assert.rejects(app.readAttachment(new File([new Uint8Array(app.MAX_FILE_BYTES + 1)], "large.txt")), /5 MB/);
  await assert.rejects(app.readAttachment(new File(["<script>bad</script>"], "unsafe.html")), /Supported files/);
  const excerpt = app.attachmentContext([{ id: "a", name: "long.txt", text: "x".repeat(5000), truncated: false }], 100);
  assert.match(excerpt, /Excerpt only/);
});

test("DOCX and PDF exports contain the complete text and preserve Unicode", async () => {
  const text = "# Project brief\n\nRésumé – café. Deliver the prototype.\n\n- Validate the result.\n\n```python\nprint(42)\n```";
  const docx = await app.exportDocx(text);
  const entries = unzipSync(new Uint8Array(await docx.arrayBuffer()));
  const xml = strFromU8(entries["word/document.xml"]);
  assert.match(xml, /Résumé – café/); assert.match(xml, /print\(42\)/);
  const bytes = await readFile(path.join(root, "public/fonts/DejaVuSans.ttf"));
  const font = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pdf = await app.exportPdf(text, font);
  assert.equal(pdf.type, "application/pdf"); assert.ok(pdf.size > 1000);
  await mkdir(path.join(root, "outputs/fixtures"), { recursive: true });
  await writeFile(path.join(root, "outputs/fixtures/project-brief.docx"), new Uint8Array(await docx.arrayBuffer()));
  await writeFile(path.join(root, "outputs/fixtures/project-brief.pdf"), new Uint8Array(await pdf.arrayBuffer()));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) });
  const parsed = await loading.promise;
  const extracted = (await (await parsed.getPage(1)).getTextContent()).items.map(item => item.str ?? "").join(" ");
  assert.match(extracted, /Résumé – café/); assert.match(extracted, /print\(42\)/);
  await loading.destroy();
});

test("HTML preview rejects external connections and origin access", () => {
  const preview = app.previewDocument('<html><script>fetch("https://example.com")</script></html>');
  assert.match(preview, /connect-src 'none'/); assert.match(preview, /frame-src 'none'/); assert.match(preview, /form-action 'none'/);
  assert.match(preview, /base-uri 'none'/);
});

test("cancellation halts execution before an answer can be accepted", async () => {
  const controller = new AbortController();
  await assert.rejects(app.executeObjective("Write Python code", "satoshi", [], [], { modes: ["cpu"], signal: controller.signal, status() {}, async infer() { controller.abort(); return { text: "```python\nprint(1)\n```" }; } }), { name: "AbortError" });
});

test("vendored diffusion and tokenizer WASM are valid and the scheduler is bounded", async () => {
  for (const file of ["stable_diffusion_webgpu.wasm", "tokenizers-wasm/tokenizers_wasm_bg.wasm"]) assert.equal(WebAssembly.validate(await readFile(path.join(root, "public/media/vendor", file))), true);
  const scheduler = JSON.parse(await readFile(path.join(root, "public/media/vendor/scheduler_dpm_solver_multistep_consts.json"), "utf8"));
  assert.equal(scheduler.num_steps, 20);
});
