import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url).pathname;
await mkdir(new URL('../outputs', import.meta.url), { recursive: true });
const out = new URL('../outputs/conversation-recovery.mjs', import.meta.url);
await build({ stdin: { contents: ['answer','orchestration','execution','inference-policy','browser-runtime','local-model','model-cache'].map(name => `export * from './app/archindus/${name}';`).join('\n'), resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: out.pathname, logLevel: 'silent' });
const app = await import(out.href);
const pair = (user, assistant, extra = {}) => [{role:'user',content:user,status:'complete'}, {role:'assistant',content:assistant,status:'complete', ...extra}];
const conversation = [
  ...pair('Our project is Cedar and its color is teal.', 'Cedar, teal. Got it.'),
  ...pair('Write a two-line poem about it.', 'Cedar grows in teal light.\nTomorrow opens bright.', {agentId:'ounumi',task:'chat'}),
  ...pair('Make it calmer.', 'Cedar rests in teal light.\nQuiet branches hold the night.', {agentId:'ounumi',task:'chat'}),
];

test('completed turns, opening details and alternating roles survive bounded context', () => {
  const long = [...conversation, ...Array.from({length:8}, (_,i) => pair(`Question ${i}`, `Answer ${i} ` + 'detail '.repeat(60))).flat()];
  const context = app.modelContext(long, 'What was the project name and color?', 2400);
  assert.match(context[0].content, /Cedar.*teal/);
  assert.match(context.at(-2).content, /Answer 7/);
  assert.equal(context.at(-1).content, 'What was the project name and color?');
  assert.ok(context.reduce((n,m)=>n+m.content.length,0) <= 2400);
  context.forEach((message,index) => assert.equal(message.role, index%2 ? 'assistant' : 'user'));
  assert.deepEqual(app.modelContext(conversation,'Now make it hopeful.',6000).slice(0,-1), conversation.map(({role,content})=>({role,content})));
});

test('a failed image cannot erase earlier completed constraints or contaminate new writing', async () => {
  const history = [...conversation, ...pair('Create an image of a fox', 'GPU failed', {status:'error',task:'image',objective:'Create an image of a fox',agentId:'ounumi'})];
  await app.executeObjective('Write a brief poem about our project.', 'architect', history, [], {
    modes:['cpu'], signal:AbortSignal.timeout(5000), status(){},
    async infer(mode,action,plan,objective,context) { assert.match(JSON.stringify(context), /Cedar/); assert.doesNotMatch(JSON.stringify(context), /fox|GPU failed/); return {text:'Cedar rests in teal light.'}; },
    image(){throw new Error('Wrong executor');},
  });
});

test('code follow-ups preserve the task and agent without concatenating past prompts', () => {
  const history = pair('Write Python code for add(a,b).','```python\ndef add(a,b): return a+b\n```', {agentId:'satoshi',task:'code',objective:'Write Python code for add(a,b).'});
  const next = app.fallbackPlan('Make it accept a list instead.', 'architect', history);
  assert.equal(next.primaryId,'satoshi'); assert.equal(next.task,'code'); assert.equal(next.objective,'Make it accept a list instead.');
});

test('transport context drops UI metadata and permits more than four exchanges within limits', () => {
  const history = [...conversation, ...conversation, ...conversation].map(m => ({...m, media:[{url:'blob:private-artifact'}], attachments:[{id:'private-file-id'}]}));
  const result = app.transportHistory(history);
  assert.ok(result.length > 8 && result.length <= 40);
  assert.doesNotMatch(JSON.stringify(result), /private-artifact|private-file-id/);
  assert.ok(result.every(m => m.content.length <= 16000));
});

class FakeWorker extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = String(url); this.terminated = false; FakeWorker.instances.push(this); }
  postMessage(request) { this.request = request; }
  send(value) { this.dispatchEvent(new MessageEvent('message',{data:{requestId:this.request.requestId,...value}})); }
  terminate() { this.terminated = true; }
}
const plan = app.fallbackPlan('Remember Cedar.', 'architect', []);

test('GPU failures recover to CPU, preserve context, and reuse the warm CPU worker', async () => {
  const original = globalThis.Worker; globalThis.Worker = FakeWorker; FakeWorker.instances = [];
  const runtime = new app.BrowserRuntime(()=>{});
  try {
    const first = runtime.request('webgpu','generate',plan,conversation,'Remember Cedar.',new AbortController().signal);
    const gpu = FakeWorker.instances.at(-1); gpu.send({type:'error',error:'Device lost'});
    await assert.rejects(first,/Device lost/); assert.equal(gpu.terminated,true);
    assert.deepEqual(app.inferenceModes(true,false,true),['webgpu','cpu']);
    await assert.rejects(runtime.request('webgpu','generate',plan,conversation,'Follow-up',new AbortController().signal),/compatibility/);
    assert.equal(FakeWorker.instances.length,1);
    const partials = [];
    const second = runtime.request('cpu','generate',plan,conversation,'What color?',new AbortController().signal,value=>partials.push(value));
    const cpu = FakeWorker.instances.at(-1);
    assert.deepEqual(cpu.request.history,conversation);
    cpu.send({type:'partial',text:'Teal'}); cpu.send({type:'complete',text:'Teal.'});
    assert.equal((await second).text,'Teal.'); assert.deepEqual(partials,['Teal']);
    const third = runtime.request('cpu','generate',plan,conversation,'Project name?',new AbortController().signal);
    assert.equal(FakeWorker.instances.at(-1),cpu); cpu.send({type:'complete',text:'Cedar'}); await third;
  } finally { runtime.cancel(); globalThis.Worker = original; }
});

test('a CPU crash retries once with retained context and a fresh worker', async () => {
  const original = globalThis.Worker; globalThis.Worker = FakeWorker; FakeWorker.instances = [];
  const runtime = new app.BrowserRuntime(()=>{});
  try {
    const crash = runtime.request('cpu','generate',plan,conversation,'First',new AbortController().signal);
    const failed = FakeWorker.instances.at(-1); failed.dispatchEvent(new Event('error'));
    await new Promise(setImmediate);
    const recovered = FakeWorker.instances.at(-1);
    assert.notEqual(recovered,failed); assert.equal(failed.terminated,true);
    assert.deepEqual(recovered.request.history,conversation);
    recovered.send({type:'complete',text:'Cedar'}); assert.equal((await crash).text,'Cedar');
    const repeated = runtime.request('cpu','generate',plan,conversation,'Second',new AbortController().signal);
    recovered.dispatchEvent(new Event('error')); await new Promise(setImmediate);
    FakeWorker.instances.at(-1).dispatchEvent(new Event('error'));
    await assert.rejects(repeated,/stopped unexpectedly/);
    assert.equal(FakeWorker.instances.length,3);
  } finally { runtime.cancel(); globalThis.Worker = original; }
});

test('Stop waits for the worker acknowledgement before reusing the warm model', async () => {
  const original = globalThis.Worker; globalThis.Worker = FakeWorker; FakeWorker.instances = [];
  const runtime = new app.BrowserRuntime(()=>{});
  try {
    const abort = new AbortController();
    const pending = runtime.request('cpu','generate',plan,conversation,'Second',abort.signal);
    const cancelled = FakeWorker.instances.at(-1);
    abort.abort(); await assert.rejects(pending,{name:'AbortError'});
    assert.equal(cancelled.request.type,'stop'); assert.equal(cancelled.terminated,false);
    const next = runtime.request('cpu','generate',plan,conversation,'Third',new AbortController().signal);
    assert.equal(cancelled.request.type,'stop');
    cancelled.send({type:'stopped'}); await new Promise(setImmediate);
    assert.equal(cancelled.request.objective,'Third'); assert.deepEqual(cancelled.request.history,conversation);
    cancelled.send({type:'complete',text:'Ready'}); assert.equal((await next).text,'Ready');
    assert.equal(FakeWorker.instances.length,1);
    runtime.cancel(); assert.equal(cancelled.terminated,true);
  } finally { runtime.cancel(); globalThis.Worker = original; }
});

test('Stop also cancels a follow-up waiting for an earlier cancellation', async () => {
  const original = globalThis.Worker; globalThis.Worker = FakeWorker; FakeWorker.instances = [];
  const runtime = new app.BrowserRuntime(()=>{});
  try {
    const firstAbort = new AbortController();
    const first = runtime.request('cpu','generate',plan,conversation,'First',firstAbort.signal);
    const worker = FakeWorker.instances.at(-1);
    firstAbort.abort(); await assert.rejects(first,{name:'AbortError'});
    const secondAbort = new AbortController();
    const second = runtime.request('cpu','generate',plan,conversation,'Second',secondAbort.signal);
    secondAbort.abort(); await assert.rejects(second,{name:'AbortError'});
    assert.equal(worker.request.type,'stop');
    worker.send({type:'stopped'}); await new Promise(setImmediate);
    assert.equal(worker.request.type,'stop');
    const third = runtime.request('cpu','generate',plan,conversation,'Third',new AbortController().signal);
    worker.send({type:'complete',text:'Cedar and teal.'});
    assert.equal((await third).text,'Cedar and teal.');
    assert.equal(FakeWorker.instances.length,1);
  } finally { runtime.cancel(); globalThis.Worker = original; }
});

test('CPU token steps yield to pending cancellation messages without changing results', async () => {
  let stopped = false;
  setTimeout(() => { stopped = true; }, 0);
  const output = { token: 42 };
  assert.equal(await app.cooperativeStep(async () => output), output);
  assert.equal(stopped, true);
});


test('cache-only fetch never downloads missing models, even when storage fails', async () => {
  let downloads = 0;
  const network = async () => { downloads++; return new Response('network'); };
  for (const storage of [undefined, {match: async () => undefined}, {match: async () => {throw Error('denied')}}]) {
    const cached = app.cacheAwareFetch(network, storage, 'https://app.example', () => true);
    await assert.rejects(cached('https://huggingface.co/model/weights.onnx'), /saved browser model/);
  }
  assert.equal(downloads, 0);
  const hit = app.cacheAwareFetch(network, {match: async () => new Response('saved')}, 'https://app.example', () => true);
  assert.equal(await (await hit('https://huggingface.co/model/weights.onnx')).text(), 'saved');
  assert.equal(downloads, 0);
  const enabled = app.cacheAwareFetch(network, undefined, 'https://app.example', () => false);
  await enabled('https://huggingface.co/model/weights.onnx');
  assert.equal(downloads, 1);
});

test('hosted outage reaches cached CPU with retained context and stops on success', async () => {
  const calls = [];
  const result = await app.executeObjective('Write a short poem about our project.', 'architect', conversation, [], {
    modes: app.inferenceModes(false,false,true), signal: new AbortController().signal, status() {},
    async infer(mode, action, plan, objective, history) {
      calls.push(mode); assert.deepEqual(history, conversation);
      if(mode !== 'cpu') throw Error('unavailable');
      return {text:'Cedar rests in teal light.', model:'Saved CPU'};
    }
  });
  assert.deepEqual(calls,['hosted','webgpu','cpu']);
  assert.equal(result.model,'Saved CPU');
});


test('installed Transformers accepts cache-only options and reads saved model bytes', async () => {
  const {env} = await import('../node_modules/@huggingface/transformers/src/env.js');
  const {getModelFile} = await import('../node_modules/@huggingface/transformers/src/utils/hub.js');
  const saved = {allowLocalModels:env.allowLocalModels,useCustomCache:env.useCustomCache,customCache:env.customCache};
  try {
    env.useCustomCache=true;
    env.customCache={match: async () => new Response('saved weights'),put:async()=>{}};
    const bytes=await getModelFile('test/model','weights.bin',true,app.localCacheOptions(env,true));
    assert.equal(new TextDecoder().decode(bytes),'saved weights');
    app.localCacheOptions(env,false);
    assert.equal(env.allowLocalModels,false);
  } finally {Object.assign(env,saved);}
});


test('ready local runtime answers before unavailable online services without egress', async () => {
  const calls = [];
  const result = await app.executeObjective('What color did I choose for Cedar?', 'architect', conversation, [], {
    modes: app.inferenceModes(false, true, true, 'webgpu'), signal: new AbortController().signal, status() {},
    async infer(mode, action, plan, objective, history) {
      calls.push([mode, action]); assert.deepEqual(history, conversation);
      return {text:'You chose teal for Cedar.', model:'Warm GPU'};
    },
  });
  assert.deepEqual(calls, [['webgpu', 'generate']]);
  assert.equal(result.model, 'Warm GPU');
  assert.deepEqual(app.inferenceModes(true,true,false,'webgpu'), ['cpu']);
});

test('fast GPU candidates exist in installed WebLLM for both shader precisions', async () => {
  const {prebuiltAppConfig} = await import('@mlc-ai/web-llm');
  for (const f16 of [true,false]) {
    for (const candidate of app.browserModelCandidates('auto', f16)) {
      assert.ok(prebuiltAppConfig.model_list.some(model => model.model_id === candidate.id), candidate.id);
    }
    assert.match(app.browserModelCandidates('auto', f16)[0].id, /Qwen2.5-0.5B-Instruct/);
  }
});
