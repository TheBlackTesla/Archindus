import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import path from 'node:path';import {openSqlite} from './helpers/sqlite.mjs';
await build({stdin:{contents:["export * from './lib/inference/live-search'","export * from './app/archindus/freshness'","export * from './app/archindus/execution'"].join(';'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'outputs/live-search-test.mjs',logLevel:'silent'});
const app=await import('../outputs/live-search-test.mjs');
const data=()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'The current leader is Example.'}]},groundingMetadata:{webSearchQueries:['current leader'],groundingChunks:[{web:{uri:'https://official.example/leader',title:'Official leader'}}],groundingSupports:[{segment:{text:'The current leader is Example.'},groundingChunkIndices:[0]}],searchEntryPoint:{renderedContent:'<div>Search suggestions</div>'}}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:10}});
test('freshness routes news, changing roles, explicit search and dependent followups, while stable work stays local',()=>{
 for(const q of ['Latest AI news today','Who is the CEO of Microsoft?','Weather in Washington today','What is the price of Bitcoin?','/search photosynthesis sources','Research Ollama releases'])assert.equal(app.needsLiveSearch(q),true,q);
 for(const q of ['Write HTML for a snake game','Translate hello into French','Explain photosynthesis','Shorten this sentence'])assert.equal(app.needsLiveSearch(q),false,q);
 assert.equal(app.needsLiveSearch('What about Apple?',[{role:'user',content:'Who is the CEO of Microsoft?'}]),true);
});
test('grounding needs actual search, supported claims and safe source links',()=>{
 const result=app.groundedResult(data(),Date.now());assert.match(result.text,/\[1\]\(https:\/\/official.example\/leader\)/);assert.match(result.text,/retrieved/);assert.match(result.searchSuggestions,/Search suggestions/);
 const noSearch=data();delete noSearch.candidates[0].groundingMetadata.webSearchQueries;assert.throws(()=>app.groundedResult(noSearch,Date.now()));
 const bad=data();bad.candidates[0].groundingMetadata.groundingChunks[0].web.uri='javascript:alert(1)';assert.throws(()=>app.groundedResult(bad,Date.now()));
 const unsupported=data();unsupported.candidates[0].groundingMetadata.groundingSupports=[];assert.throws(()=>app.groundedResult(unsupported,Date.now()));
});
test('budgeted live search uses existing credentials, settles tool costs, and never makes a call when denied',async()=>{
 const dir=await mkdtemp(path.join(process.cwd(),'outputs/live-search-')),db=openSqlite(path.join(dir,'db.sqlite'));
 try{const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const e of journal.entries)for(const sql of (await readFile('drizzle/'+e.tag+'.sql','utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 let calls=0;const req=()=>new Request('https://site.test/api/archindus/hosted');const deps={key:'private-search-key',db,limits:{day:1000000,month:10000000},now:Date.now(),id:crypto.randomUUID(),send:async(url,init)=>{calls++;assert.match(url,/gemini-3.8-flash:generateContent/);assert.equal(init.headers['x-goog-api-key'],'private-search-key');const body=JSON.parse(init.body);assert.deepEqual(body.tools,[{google_search:{}}]);assert.equal(body.contents[0].parts[0].text,'Latest AI news');return Response.json(data())}};
 const result=await (await app.liveSearch(req(),'Latest AI news',[],deps)).json();assert.match(result.text,/official.example/);assert.doesNotMatch(JSON.stringify(result),/private-search-key/);const row=await db.prepare('SELECT charged,reserved,active_until FROM inference_usage').first();assert.ok(row.charged>14000&&row.charged<row.reserved);assert.equal(row.active_until,0);
 const denied=await (await app.liveSearch(req(),'Latest news',[],{...deps,id:crypto.randomUUID(),limits:{day:0,month:0}})).json();assert.match(denied.text,/spending limit/);assert.equal(calls,1);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('offline and failed online search never fall back to an ungrounded model answer',async()=>{
 const attempts=[];const ports={modes:['hosted','cpu'],signal:new AbortController().signal,status:()=>{},image:async()=>{throw Error()},infer:async(mode)=>{attempts.push(mode);throw Error('offline')}};
 const result=await app.executeObjective('Latest AI news today','architect',[],[],ports);assert.match(result.text,/will not substitute/);assert.deepEqual(attempts,['hosted']);
 attempts.length=0;const offline=await app.executeObjective('Latest AI news today','architect',[],[],{...ports,modes:['cpu']});assert.match(offline.text,/Switch to Automatic/);assert.equal(attempts.length,0);
});

test('Gemini quota exhaustion falls back to one bounded OpenAI web search with citations; provider safety blocks do not fall through',async()=>{
 const dir=await mkdtemp(path.join(process.cwd(),'outputs/search-fallback-')),db=openSqlite(path.join(dir,'db.sqlite'));
 try{const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const e of journal.entries)for(const sql of (await readFile('drizzle/'+e.tag+'.sql','utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const calls=[];const answer='Microsoft’s CEO is Satya Nadella.';
 const response=()=>({status:'completed',model:'gpt-6-luna',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:answer,annotations:[{type:'url_citation',url:'https://www.microsoft.com/en-us/about/leadership',title:'Microsoft leadership',start_index:0,end_index:answer.length}]}]}],usage:{input_tokens:100,output_tokens:20}});
 const deps={key:'gemini-private',openAIKey:'openai-private',db,limits:{day:1000000,month:10000000},now:Date.now(),id:crypto.randomUUID(),send:async(url,init)=>{calls.push(url);if(url.includes('googleapis'))return Response.json({error:{status:'RESOURCE_EXHAUSTED',message:'Quota reached'}},{status:429});const body=JSON.parse(init.body);assert.equal(body.model,'gpt-6-luna');assert.equal(body.max_tool_calls,1);assert.equal(body.store,false);assert.equal(body.tool_choice,'required');return Response.json(response())}};
 const request=()=>new Request('https://site.test/api/archindus/hosted');
 const result=await (await app.liveSearchWithFallback(request(),'Who is the current CEO of Microsoft?',[],deps)).json();assert.match(result.model,/OpenAI Web Search/);assert.match(result.text,/microsoft.com/);assert.deepEqual(result.receipt.attempts.map(a=>a.outcome),['rate_limit','complete']);assert.equal(calls.length,2);assert.doesNotMatch(JSON.stringify(result),/gemini-private|openai-private/);
 calls.length=0;await app.liveSearchWithFallback(request(),'Who is the current CEO of Microsoft?',[],deps);assert.equal(calls.length,0,'A repeated request ID cannot charge another fallback');
 calls.length=0;await app.liveSearchWithFallback(request(),'Latest Microsoft news',[],{...deps,id:crypto.randomUUID()});assert.equal(calls.length,1);assert.match(calls[0],/api.openai.com/);
 await db.prepare('DELETE FROM inference_provider_state').run();calls.length=0;
 const refused=await (await app.liveSearchWithFallback(request(),'Latest news',[],{...deps,id:crypto.randomUUID(),send:async url=>{calls.push(url);return Response.json({candidates:[{finishReason:'SAFETY'}]})}})).json();assert.match(refused.model,/verification unavailable/);assert.equal(calls.length,1);
 const noSearch=response();noSearch.output=noSearch.output.filter(i=>i.type!=='web_search_call');assert.throws(()=>app.openAISearchResult(noSearch,Date.now()));
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
