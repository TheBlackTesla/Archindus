import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {openSqlite} from './helpers/sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');await build({stdin:{contents:["lib/inference/hosted","lib/inference/providers","lib/inference/provider-transport","lib/inference/budget","app/archindus/stream"].map(f=>`export * from './${f}';`).join('\n'),resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(root,'outputs/multi-provider-test.mjs'),logLevel:'silent'});const app=await import('../outputs/multi-provider-test.mjs'),directory=await mkdtemp(path.join(root,'outputs/multi-provider-')),db=openSqlite(path.join(directory,'test.sqlite'));const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));for(const entry of journal.entries)for(const sql of (await readFile(path.join(root,'drizzle',entry.tag+'.sql'),'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();after(async()=>{db.close();await rm(directory,{recursive:true,force:true})});beforeEach(async()=>{await db.prepare('DELETE FROM inference_usage').run();await db.prepare('DELETE FROM inference_provider_state').run()});
const request=(extra={})=>new Request('https://site.test/api/archindus/hosted',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),action:'generate',selectedAgentId:'architect',objective:'Analyze the sales data and compare revenue trends',history:[],...extra})});
const success=text=>Response.json({choices:[{message:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}});
const deps=(providers,fetch)=>({enabled:true,key:'test-openai-key',db,limits:app.DEFAULT_LIMITS,providers,fetch});
test('known external providers activate only with their own keys; credentials never appear in public inventory',()=>{const c=app.providerConfiguration({DEEPSEEK_API_KEY:'test-deepseek',ANTHROPIC_API_KEY:'test-claude',XAI_API_KEY:'test-grok'});assert.deepEqual(c.providers.map(p=>p.id),['deepseek','xai','anthropic']);assert.doesNotMatch(JSON.stringify(c.inventory),/test-deepseek|test-claude|test-grok/);assert.equal(app.providerConfiguration({}).providers.length,0);assert.ok(c.inventory.some(m=>m.architecture==='MoE'));assert.ok(app.providerConfiguration({HF_TOKEN:'test-hf'}).providers.length===0,'Unknown-price hosted models are not auto-enabled')});
test('cheapest capable provider receives continuity and Archindus identity; token usage settles globally',async()=>{const c=app.providerConfiguration({DEEPSEEK_API_KEY:'test-deepseek'});let payload,url;const r=await app.handleHosted(request({history:[{role:'user',content:'Use the codename Orion.'},{role:'assistant',content:'Understood.'}]}),deps(c.providers,async(u,init)=>{url=u;payload=JSON.parse(init.body);return success('An index helps find rows efficiently.')}));assert.equal(r.status,200);assert.match(url,/api.deepseek.com/);assert.equal(payload.model,'deepseek-flash');assert.ok(payload.messages.some(m=>m.content.includes('Orion')));assert.match(payload.messages[0].content,/identity.*Archindus|You are Archindus/);const data=await r.json();assert.match(data.model,/DeepSeek/);const row=await db.prepare('SELECT * FROM inference_usage').first();assert.ok(row.charged<row.reserved)});
test('Ollama discovers installed models, selects a small routine model, and does not pull weights',async()=>{const c=app.providerConfiguration({OLLAMA_BASE_URL:'https://gpu.trycloudflare.com/v1',OLLAMA_API_KEY:'gateway-key'});let model,calls=[];const r=await app.handleHosted(request({objective:'Explain rain in one sentence'}),deps(c.providers,async(u,init)=>{calls.push(String(u));if(String(u).endsWith('/models'))return Response.json({data:[{id:'qwen3.5:4b'},{id:'qwen3.5:27b'}]});model=JSON.parse(init.body).model;return success('Rain falls when droplets grow heavy.')}));assert.equal(r.status,200);assert.equal(model,'qwen3.5:4b');assert.equal((await db.prepare('SELECT charged FROM inference_usage').first()).charged,0);assert.ok(calls.every(u=>!u.includes('/pull')))});
test('a failing provider falls back to OpenAI and provider cooldowns remain isolated',async()=>{const c=app.providerConfiguration({DEEPSEEK_API_KEY:'bad-key'});const calls=[];const r=await app.handleHosted(request(),deps(c.providers,async(u)=>{calls.push(String(u));return String(u).includes('deepseek')?Response.json({error:{code:'invalid_api_key'}},{status:401}):success('Recovered through the configured fallback.')}));assert.equal(r.status,200);assert.equal(calls.length,2);assert.match((await r.json()).model,/OpenAI/);assert.ok(await app.providerCooldownSeconds(db,Date.now(),'deepseek'));assert.equal(await app.providerCooldownSeconds(db),0)});
test('a rate-limited provider preserves conversation through failover and reports the answering model', async () => {
 const {providers}=app.providerConfiguration({DEEPSEEK_API_KEY:'test-deepseek'});
 const history=[{role:'user',content:'Our project codename is Cedar.'},{role:'assistant',content:'Understood.'}];
 const seen=[];
 const primary={...providers[0],models:providers[0].models.slice(0,1)};
 const response=await app.handleHosted(request({history}),deps([primary],async(url,init)=>{
  const payload=JSON.parse(init.body);
  seen.push(payload.messages);
  if(String(url).includes('deepseek')) return Response.json({error:{code:'rate_limit_exceeded'}},{status:429,headers:{'Retry-After':'10'}});
  return success('The project codename is Cedar.');
 }));
 assert.equal(response.status,200);
 assert.deepEqual(seen,[seen[0],seen[0]]);
 assert.ok(seen[0].some(message=>message.content.includes('Cedar')));
 const answer=await response.json();
 assert.match(answer.model,/GPT-6.2 Sol/);
 assert.deepEqual(answer.receipt.attempts.map(a=>a.outcome),['rate_limit','complete']);
});
test('provider refusals never trigger another provider and no call bypasses a zero spending limit',async()=>{const c=app.providerConfiguration({DEEPSEEK_API_KEY:'key'});let calls=0;let r=await app.handleHosted(request(),deps(c.providers,async()=>{calls++;return Response.json({error:{code:'content_policy_violation'}},{status:422})}));assert.equal(r.status,422);assert.equal(calls,1);r=await app.handleHosted(request(),{...deps(c.providers,async()=>{calls++;return success('Forbidden cost')}),limits:{day:0,month:0}});assert.equal(r.status,429);assert.equal(calls,1)});
test('Anthropic translation preserves system/history and excludes thinking deltas from public streams',async()=>{const provider=app.providerConfiguration({ANTHROPIC_API_KEY:'claude-key'}).providers[0],model=provider.models[0];let payload,headers;const input=[{role:'system',content:'You are Archindus.'},{role:'user',content:'Hello'}];const response=await app.providerCompletion(provider,model,input,1800,true,new AbortController().signal,async(u,init)=>{payload=JSON.parse(init.body);headers=init.headers;assert.match(String(u),/\/messages$/);return new Response(new Blob([app.encodeEvent({type:'message_start',message:{usage:{input_tokens:100}}}),app.encodeEvent({type:'content_block_delta',delta:{type:'thinking_delta',thinking:'private reasoning'}}),app.encodeEvent({type:'content_block_delta',delta:{type:'text_delta',text:'I am Archindus.'}}),app.encodeEvent({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}})]),{headers:{'Content-Type':'text/event-stream'}})});const text=await response.text();assert.match(text,/I am Archindus/);assert.doesNotMatch(text,/private reasoning/);assert.equal(headers['x-api-key'],'claude-key');assert.equal(payload.system,'You are Archindus.');assert.equal(payload.messages.length,1);assert.match(text,/"finish_reason":"stop"/)});
test('endpoint and model policies reject credential URLs and falsely free hosted models',()=>{assert.throws(()=>app.safeRuntimeURL('https://key:secret@example.com/v1'));assert.throws(()=>app.safeRuntimeURL('http://remote.example/v1'));const c=app.providerConfiguration({HF_TOKEN:'hf',ARCHINDUS_PROVIDER_MODELS:JSON.stringify({huggingface:[{id:'costly',name:'Costly',input:0,output:0,level:1,capabilities:['chat']}]})});assert.equal(c.providers.length,0);assert.equal(c.issues.length,1)});
test('stream safety errors retain refusal semantics rather than becoming a fallbackable interruption',async()=>{const upstream=new Response(app.encodeEvent({error:{code:'content_policy_violation'}}),{headers:{'Content-Type':'text/event-stream'}});const response=await app.handleHosted(request({stream:true}),deps([],async()=>upstream));const text=await response.text();assert.match(text,/content_refused/)});

test('Groq activates three bounded text models and only an explicit Free Plan declaration zeroes their prices',()=>{
 const paid=app.providerConfiguration({GROQ_API_KEY:'groq-secret'});
 const provider=paid.providers.find(p=>p.id==='groq');assert.equal(provider.models.length,3);assert.ok(provider.models.every(m=>m.input>0&&m.output>0));
 const free=app.providerConfiguration({GROQ_API_KEY:'groq-secret',ARCHINDUS_GROQ_FREE_TIER:'true'});
 assert.equal(free.issues.length,0);assert.ok(free.providers[0].models.every(m=>m.input===0&&m.output===0));assert.doesNotMatch(JSON.stringify(free.inventory),/groq-secret/);
 const invalid=app.providerConfiguration({GROQ_API_KEY:'key',ARCHINDUS_GROQ_FREE_TIER:'true',ARCHINDUS_PROVIDER_MODELS:JSON.stringify({groq:[{id:'unknown-model',name:'Unknown',input:0,output:0,level:1,capabilities:['chat']}]})});
 assert.equal(invalid.providers.length,0);assert.equal(invalid.issues.length,1);
});
test('Groq transport uses model-specific reasoning controls without returning internal reasoning as content',async()=>{
 const provider=app.providerConfiguration({GROQ_API_KEY:'test-reasoning'}).providers[0];
 for(const model of provider.models){let body;await app.providerCompletion(provider,model,[{role:'user',content:'Hello'}],1200,true,new AbortController().signal,async(url,init)=>{body=JSON.parse(init.body);assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');return success('Hello')});
 if(model.id.startsWith('openai/')){assert.equal(body.include_reasoning,false);assert.equal(body.reasoning_format,undefined);assert.ok(['low','high'].includes(body.reasoning_effort))}else{assert.equal(body.reasoning_format,'hidden');assert.equal(body.reasoning_effort,'none')}
 }
});
test('Groq discovery excludes unlisted models and a rate-limited free model falls back without paid calls',async()=>{
 const providers=app.providerConfiguration({GROQ_API_KEY:'groq-discovery-route-test',ARCHINDUS_GROQ_FREE_TIER:'true'}).providers;
 const calls=[];let discoveries=0;
 const fetch=async(url,init)=>{
 if(String(url).includes('api.groq.com')&&String(url).endsWith('/models')){discoveries++;return Response.json({data:[{id:'openai/gpt-oss-20b'},{id:'qwen/qwen3.8-27b'}]})}
 if(!String(url).includes('/chat/completions'))return Response.json({data:[]});
 assert.match(String(url),/api.groq.com/);const model=JSON.parse(init.body).model;calls.push(model);
 return model==='openai/gpt-oss-20b'?Response.json({error:{code:'rate_limit_exceeded'}},{status:429,headers:{'retry-after':'60','x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'2m59.56s'}}):success('Recovered with the next free Groq model.');
 };
 const dependencies={...deps(providers,fetch),limits:{day:0,month:0}};
 const r=await app.handleHosted(request({objective:'Tell me a short story.'}),dependencies);assert.equal(r.status,200);const data=await r.json();
 assert.match(data.model,/Qwen 3.8 27B.*Groq/);assert.deepEqual(calls,['openai/gpt-oss-20b','qwen/qwen3.8-27b']);assert.deepEqual(data.receipt.attempts.map(a=>a.outcome),['rate_limit','complete']);
 assert.ok((await db.prepare('SELECT unavailable_until FROM inference_provider_state WHERE provider=?').bind('model:groq:openai/gpt-oss-20b').first()).unavailable_until>Date.now()+170000);
 const all=await db.prepare('SELECT SUM(charged) total FROM inference_usage').first();assert.equal(all.total,0);
 calls.length=0;await app.handleHosted(request({objective:'Tell me another short story.'}),dependencies);assert.deepEqual(calls,['qwen/qwen3.8-27b']);assert.equal(discoveries,1);
});
test('demanding prompts select Groq GPT-OSS 120B and preserve Archindus identity on the free tier',async()=>{
 const providers=app.providerConfiguration({GROQ_API_KEY:'groq-demanding-test',ARCHINDUS_GROQ_FREE_TIER:'true'}).providers;
 let chosen;
 const r=await app.handleHosted(request({objective:'Give a rigorous proof that there are infinitely many prime numbers.'}),{...deps(providers,async(url,init)=>{
 if(String(url).includes('api.groq.com')&&String(url).endsWith('/models'))return Response.json({data:providers[0].models.map(m=>({id:m.id}))});
 if(!String(url).includes('/chat/completions'))return Response.json({data:[]});assert.match(String(url),/api.groq.com/);const body=JSON.parse(init.body);chosen=body.model;assert.match(body.messages[0].content,/Archindus/);assert.equal(body.max_tokens,4096);return success('Assume there are finitely many primes. Their product plus one gives a contradiction.');
 }),limits:{day:0,month:0}});assert.equal(r.status,200);assert.equal(chosen,'openai/gpt-oss-120b');
});
