import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdir} from "node:fs/promises";
const root=new URL("../",import.meta.url).pathname,out=new URL("../outputs/device-workspace.mjs",import.meta.url);
await mkdir(new URL("../outputs",import.meta.url),{recursive:true});
await build({stdin:{contents:["device-models","run-record","model-cache","native-model","workbench","execution","orchestration","answer","stream","browser-runtime"].map(f=>'export * from "./app/archindus/'+f+'";').join("\n")+'\nexport {POST as privateChat} from "./app/api/archindus/chat/route";',resolveDir:root},platform:"node",bundle:true,packages:"external",format:"esm",outfile:out.pathname,logLevel:"silent"});
const app=await import(out.href), weight="https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4.onnx";
const gid="Qwen2.5-0.5B-Instruct-q4f32_1-MLC",gpuBase="https://huggingface.co/mlc-ai/"+gid+"/resolve/main/";
const plan=app.fallbackPlan("Tell me a story","architect",[]);
class DiskCache {
  data=new Map();calls=[];
  key(x){return typeof x==="string"?x:x.url}
  async match(x){return this.data.get(this.key(x))?.clone()}
  async keys(){return [...this.data.keys()].map(k=>new Request(k))}
  async put(x,v){this.data.set(this.key(x),v)}
  async add(x){this.calls.push(this.key(x));await this.put(x,new Response("shard"))}
  async addAll(xs){for(const x of xs)await DiskCache.prototype.add.call(this,x)}
}
function disk(){const m=new Map();return{async keys(){return [...m.keys()]},async open(n){if(!m.has(n))m.set(n,new DiskCache());return m.get(n)},async match(x){for(const s of m.values()){const hit=await s.match(x);if(hit)return hit}}}}
test("a fresh visit discovers legacy GPU and CPU files and reuses the original precision",async()=>{
 const d=disk();await(await d.open("transformers-cache")).put(weight,new Response("CPU"));await(await d.open("webllm/model")).put(gpuBase+"params_shard_0.bin",new Response("GPU"));
 const models=await app.discoverDeviceModels(d);assert.deepEqual(new Set(models.map(m=>m.id)),new Set([gid,app.CPU_CHAT.id]));
 assert.equal(app.setupTarget("auto",true,true,models,gid).id,gid);assert.equal(app.setupTarget("auto",false,false,models,gid).id,app.CPU_CHAT.id);
 assert.deepEqual(app.chatModes({deviceOnly:true,qwen:true,hosted:true,native:false,saved:["cpu"]}),["cpu"]);
 assert.deepEqual(app.chatModes({deviceOnly:false,qwen:false,hosted:true,native:false,saved:[]}),["hosted"]);
});
test("WebLLM native cache acquisition cannot download a missing shard during chat; repair only fills the missing shard",async()=>{
 class WorkerCache extends DiskCache{}let locked=false;app.guardCacheAcquisition(WorkerCache.prototype,()=>locked);
 const c=new WorkerCache(),a=gpuBase+"a.bin",b=gpuBase+"b.bin";await c.add(a);locked=true;await c.add(a);
 await assert.rejects(c.add(b),/Missing saved/);await assert.rejects(c.addAll([a,b]),/Missing saved/);assert.deepEqual(c.calls,[a]);
 locked=false;await c.addAll([a,b]);locked=true;await c.addAll([a,b]);assert.deepEqual(c.calls,[a,b]);
});
test("a new worker reuses the original runtime WASM and weights with zero repeat network calls",async()=>{
 const d=disk();let calls=0;const network=async()=>{calls++;return new Response("bytes")},url="https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.wasm";
 await app.cacheAwareFetch(network,d,"https://site.test",()=>false)(url);
 const fresh=app.cacheAwareFetch(network,d,"https://site.test",()=>true);
 assert.equal(await(await fresh(url)).text(),"bytes");await assert.rejects(fresh(weight),/Missing saved/);
 await(await d.open("transformers-cache")).put(weight,new Response("saved"));assert.equal(await(await fresh(weight)).text(),"saved");await app.cacheAwareFetch(network,d,"https://site.test",()=>false)(weight);assert.equal(calls,1);
});
test("ordinary generation cannot inherit setup permission or silently acquire a coder model",async()=>{
 const original=globalThis.Worker;let worker;globalThis.Worker=class extends EventTarget{constructor(){super();worker=this}postMessage(x){this.req=x}terminate(){}};
 try{const r=new app.BrowserRuntime(()=>{});r.cachedOnly=false;r.modelId=app.CPU_CHAT.id;
 const done=r.request("cpu","generate",{...plan,task:"code"},[],"write code",new AbortController().signal);assert.equal(worker.req.cachedOnly,true);assert.equal(worker.req.modelId,app.CPU_CHAT.id);
 worker.dispatchEvent(new MessageEvent("message",{data:{requestId:worker.req.requestId,type:"complete",text:"ok"}}));await done;r.cancel();
 }finally{globalThis.Worker=original;}
});
test("native AI creation requires installed status and passes retained conversation to the ready model",async()=>{
 for(const state of ["unavailable","downloadable","downloading"]){let n=0;await assert.rejects(app.nativeAnswer(plan,"Hi",[],new AbortController().signal,undefined,{availability:async()=>state,create(){n++}}));assert.equal(n,0)}
 let closed=false;const options=[];const api={availability:async(o)=>{options.push(o);return "available"},create:async(o)=>{options.push(o);assert.ok(o.initialPrompts.some(p=>p.content==="Project Cedar."));return{destroy(){closed=true},promptStreaming(){return new ReadableStream({start(c){c.enqueue("Its name ");c.enqueue("is Cedar.");c.close()}})}}}};
 const result=await app.nativeAnswer(plan,"What was its name?",[{role:"user",content:"Project Cedar."},{role:"assistant",content:"OK."}],new AbortController().signal,undefined,api);assert.equal(result.text,"Its name is Cedar.");assert.ok(closed);assert.deepEqual(options[0].expectedOutputs,options[1].expectedOutputs);
});
test("offline commands return with no engine; commands and inputs stay out of later prompts",async()=>{
 const ports={signal:new AbortController().signal,modes:[],infer(){throw Error("Unexpected inference")},image(){throw Error("Unexpected image")},status(){}};
 for(const [q,pat] of [["/route Write a Python function",/Satoshi/],['/json {"x":true}',/Valid JSON/],["/json {x",/Invalid JSON/]])assert.match((await app.executeObjective(q,"architect",[],[],ports)).text,pat);
 const history=[{role:"user",content:'/json {"secret":"sentinel"}'},{role:"assistant",content:"JSON shape"},{role:"user",content:"Use teal."},{role:"assistant",content:"Okay."}];const next=JSON.stringify(app.transportHistory(history));assert.doesNotMatch(next,/sentinel|JSON shape/);assert.match(next,/teal/);
});
test("private text streams a filtered first response before completion and forwards prior turns",async()=>{
 const saved=globalThis.fetch,old=process.env.ARCHINDUS_QWEN_ENDPOINT;process.env.ARCHINDUS_QWEN_ENDPOINT="https://example.invalid/v1/";let up;
 globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);assert.equal(body.stream,true);assert.match(JSON.stringify(body.messages),/blue/);return new Response(new ReadableStream({start(c){up=c;c.enqueue(app.encodeEvent({choices:[{delta:{content:"<think>internal</think>The answer"}}]}))}}),{headers:{"content-type":"text/event-stream"}})};
 try{const res=await app.privateChat(new Request("https://site.test/api/archindus/chat",{method:"POST",headers:{origin:"https://site.test","content-type":"application/json"},body:JSON.stringify({stream:true,action:"generate",selectedAgentId:"architect",objective:"Which color?",history:[{role:"user",content:"Use blue."},{role:"assistant",content:"OK."}]})}));
 const events=app.readEvents(res.body);assert.equal((await events.next()).value.text,"The answer");up.enqueue(app.encodeEvent({choices:[{delta:{content:" is blue."},finish_reason:"stop"}]}));up.close();let last;for await(const e of events)last=e;assert.equal(last.type,"complete");assert.equal(last.text,"The answer is blue.");
 }finally{globalThis.fetch=saved;if(old===undefined)delete process.env.ARCHINDUS_QWEN_ENDPOINT;else process.env.ARCHINDUS_QWEN_ENDPOINT=old}
});

test('a stale unavailable status still reaches hosted inference when no device model is installed',async()=>{
 const modes=app.chatModes({deviceOnly:false,qwen:false,hosted:false,native:false,saved:[]});assert.deepEqual(modes,['hosted']);let attempts=0;
 const result=await app.executeObjective('Write a the html code for the snake game','architect',[],[],{modes,signal:new AbortController().signal,status:()=>{},infer:async mode=>{attempts++;assert.equal(mode,'hosted');return {text:'```html\n<!doctype html><html><body><canvas></canvas><script>console.log("snake");</script></body></html>\n```',model:'GPT-6.1 Sol'}},image:async()=>new Blob()});
 assert.equal(attempts,1);assert.equal(result.plan.primaryId,'satoshi');assert.match(result.text,/<canvas>/);
 assert.deepEqual(app.chatModes({deviceOnly:true,qwen:true,hosted:false,native:false,saved:[]}),[],'Device-only still forbids cloud calls');
});
