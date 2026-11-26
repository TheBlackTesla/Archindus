import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {openSqlite} from './helpers/sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');
await build({stdin:{contents:['lib/inference/health','lib/inference/metrics','lib/inference/hosted','lib/inference/providers','app/archindus/answer','app/archindus/stream'].map(f=>`export * from './${f}';`).join('\n'),resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(root,'outputs/routing-health-test.mjs'),logLevel:'silent'});
const app=await import('../outputs/routing-health-test.mjs');
const now=Date.now();
test('failure policies respect retry dates, isolate model errors and bound backoff',()=>{
 assert.equal(app.failurePolicy(401,null,now).scope,'provider');
 for(const status of [400,403,404,422,429,500,503])assert.equal(app.failurePolicy(status,null,now).scope,'model');
 assert.equal(app.failurePolicy(429,'120',now).seconds,120);
 assert.equal(app.failurePolicy(429,new Date(now+90000).toUTCString(),now).seconds,90);
 assert.equal(app.failurePolicy(429,'99999',now).seconds,3600);
});
test('JSON syntax validation rejects malformed output without rejecting ordinary text',()=>{
 assert.ok(app.validateAnswer('```json\n{"ok":\n```','analysis'));
 assert.equal(app.validateAnswer('```json\n{"ok":true}\n```','analysis'),null);
 assert.equal(app.validateAnswer('Use {braces} in a sentence.','chat'),null);
});
test('normal API route recovers within provider and reports every real attempted model',async()=>{
 const dir=await mkdtemp(path.join(root,'outputs/health-')),db=openSqlite(path.join(dir,'db.sqlite'));
 try{
 const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
 for(const e of journal.entries)for(const sql of (await readFile(path.join(root,'drizzle',e.tag+'.sql'),'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const models=['test/a:free','test/b:free'].map(id=>({id,name:id,input:0,output:0,level:2,capabilities:['chat']}));
 const providers=app.providerConfiguration({OPENROUTER_API_KEY:'secret-test',ARCHINDUS_PROVIDER_MODELS:JSON.stringify({openrouter:models})}).providers;
 const request=()=>new Request('https://site.test/api/archindus/hosted',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),action:'generate',selectedAgentId:'architect',objective:'Tell me a short story',history:[],stream:true})});
 const calls=[];
 const fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))return Response.json({data:[]});
 const model=JSON.parse(init.body).model;calls.push(model);
 if(model===models[0].id)return Response.json({error:{code:'rate_limit'}},{status:429,headers:{'Retry-After':'120'}});
 return new Response(app.encodeEvent({model:'actual/free-model',choices:[{delta:{content:'A small fox found a home.'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}}),{headers:{'Content-Type':'text/event-stream'}});
 };
 const response=await app.handleHosted(request(),{enabled:true,db,providers,fetch,limits:{day:0,month:0}});
 assert.equal(response.status,200);
 const events=[];for await(const e of app.readEvents(response.body,new AbortController().signal))events.push(e);
 const completed=events.find(e=>e.type==='complete');assert.ok(completed);
 assert.deepEqual(calls,models.map(m=>m.id));
 assert.deepEqual(completed.receipt.attempts.map(a=>a.outcome),['rate_limit','complete']);
 assert.match(completed.receipt.attempts[1].model,/actual\/free-model/);
 assert.ok(await app.modelCooldownSeconds(db,'openrouter',models[0].id,Date.now()));
 assert.equal(await app.operationalScore(db,'openrouter',models[1].id,'chat',Date.now()),0);
 for(let i=0;i<5;i++)await app.recordModelOutcome(db,'openrouter',models[1].id,'chat',true,200,0,Date.now());
 assert.ok(await app.operationalScore(db,'openrouter',models[1].id,'chat',Date.now())>0);
 calls.length=0;await (await app.handleHosted(request(),{enabled:true,db,providers,fetch,limits:{day:0,month:0}})).text();
 assert.deepEqual(calls,[models[1].id]);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});

test('shared OpenRouter free quota skips its other free models and reaches a free local engine before paid fallback',async()=>{
 const dir=await mkdtemp(path.join(root,'outputs/shared-quota-')),db=openSqlite(path.join(dir,'db.sqlite'));
 try{
 const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
 for(const e of journal.entries)for(const sql of (await readFile(path.join(root,'drizzle',e.tag+'.sql'),'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const models=Array.from({length:7},(_,i)=>({id:`test/${i}:free`,name:`Free ${i}`,input:0,output:0,level:1,capabilities:['chat']}));
 const providers=app.providerConfiguration({OPENROUTER_API_KEY:'test',OLLAMA_BASE_URL:'https://private.example/v1',OLLAMA_API_KEY:'local-key',OLLAMA_MODELS:'qwen3.5:4b',ARCHINDUS_PROVIDER_MODELS:JSON.stringify({openrouter:models})}).providers.sort((a,b)=>(a.id==='openrouter'?0:1)-(b.id==='openrouter'?0:1));
 const calls=[];
 const fetch=async(url,init)=>{
 if(String(url).endsWith('/models'))return Response.json({data:[{id:'qwen3.5:4b'}]});
 if(!String(url).includes('/chat/completions'))return Response.json({data:[]});
 const model=JSON.parse(init.body).model;calls.push(model);
 if(model.endsWith(':free'))return Response.json({error:{code:429}},{status:429,headers:{'X-RateLimit-Limit':'50','X-RateLimit-Remaining':'0','X-RateLimit-Reset':String(Date.now()+3600000)}});
 assert.equal(model,'qwen3.5:4b');return Response.json({model,choices:[{message:{content:'A free engine answered.'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}});
 };
 const request=()=>new Request('https://site.test/api/archindus/hosted',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),action:'generate',selectedAgentId:'architect',objective:'Tell me a short story',history:[]})});
 const deps={enabled:true,key:'paid-fallback-key',db,providers,fetch,limits:{day:0,month:0}};
 const response=await app.handleHosted(request(),deps);assert.equal(response.status,200);
 assert.deepEqual(calls,['test/0:free','qwen3.5:4b']);
 assert.deepEqual((await response.json()).receipt.attempts.map(a=>a.outcome),['rate_limit','complete']);
 assert.ok(await app.freeProviderCooldownSeconds(db,'openrouter',Date.now())>3500);
 calls.length=0;assert.equal((await app.handleHosted(request(),deps)).status,200);assert.deepEqual(calls,['qwen3.5:4b']);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
