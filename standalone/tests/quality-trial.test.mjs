import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {openSqlite} from './helpers/sqlite.mjs';
await build({stdin:{contents:['lib/inference/quality-benchmark','lib/inference/quality-trial','lib/inference/providers','lib/inference/budget'].map(f=>`export * from './${f}'`).join(';'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'outputs/quality-trial-test.mjs',logLevel:'silent'});const app=await import('../outputs/quality-trial-test.mjs');
test('deterministic graders check actual results and reject executable or unsupported model code',()=>{
 assert.equal(app.arithmeticExpression('2+3*4',{}),14);assert.equal(app.arithmeticExpression('(2+3)*4',{}),20);assert.equal(app.arithmeticExpression('2**3**2',{}),512);
 for(const source of ['process.exit()','globalThis.secret','n.constructor','n;fetch("https://example.com")','n+++2','-n**2'])assert.throws(()=>app.arithmeticExpression(source,{n:4}));
 const square=app.QUALITY_CASES.find(c=>c.id==='square-function');
 for(const expression of ['n*n','n**2'])assert.equal(app.gradeQuality(square,JSON.stringify({code:`function square(n) { return ${expression}; }`})).passed,true);
 assert.equal(app.gradeQuality(square,JSON.stringify({code:'function square(n) { return n+n; }'})).passed,false);
 assert.equal(app.gradeQuality(square,JSON.stringify({code:'function square(n) { return globalThis.process.exit(); }'})).passed,false);
 const extract=app.QUALITY_CASES.find(c=>c.id==='extract-person');assert.equal(app.gradeQuality(extract,'{"notebooks":3,"name":"Ada Lovelace"}').passed,true);assert.equal(app.gradeQuality(extract,'{"notebooks":4,"name":"Ada Lovelace"}').passed,false);assert.equal(app.gradeQuality(extract,'not json').passed,false);
});
test('quality summaries count distinct held-out tasks, preserve availability, and reject repeated evidence',()=>{
 const observations=app.QUALITY_CASES.map(c=>({caseId:c.id,arm:'shared',status:'complete',passed:true,reason:'exact_match',model:'Example',elapsedMs:100,chargedMicrodollars:0}));const summary=app.summarizeQuality(observations);
 assert.equal(summary.holdoutSamples,4);assert.equal(summary.matchedCases,12);assert.equal(summary.championPassRate,1);assert.equal(summary.challengerPassRate,1);assert.equal(summary.costRatio,1);assert.ok(summary.qualityLowerBound<0);assert.throws(()=>app.summarizeQuality([...observations,...observations]));
 const unavailable=observations.map((r,i)=>i===0?{...r,status:'unavailable',passed:false}:r);assert.equal(app.summarizeQuality(unavailable).matchedCases,11);assert.ok(app.summarizeQuality(unavailable).championAvailability<1);
});
test('protected fixed-suite trial is free-only, freezes choices, shares identical arms and prevents repeated charges',async()=>{
 const dir=await mkdtemp(path.join(process.cwd(),'outputs/quality-')),db=openSqlite(path.join(dir,'db.sqlite')),now=Date.now(),token='a'.repeat(64);const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),n=>n.toString(16).padStart(2,'0')).join('');
 try{const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const e of journal.entries)for(const sql of (await readFile('drizzle/'+e.tag+'.sql','utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const providers=app.providerConfiguration({GROQ_API_KEY:'test-trial-key',ARCHINDUS_GROQ_FREE_TIER:'true'}).providers;let generations=0;
 const send=async(url,init)=>{if(String(url).includes('api.groq.com')&&String(url).endsWith('/models'))return Response.json({data:providers[0].models.map(m=>({id:m.id}))});if(!String(url).includes('/chat/completions'))return Response.json({data:[],rows:[]});generations++;const body=JSON.parse(init.body);assert.ok(app.QUALITY_CASES.some(c=>c.prompt===body.messages[1].content));assert.equal(body.max_tokens,1024);return Response.json({model:body.model,choices:[{message:{content:'{"name":"Ada Lovelace","notebooks":3}'},finish_reason:'stop'}]})};
 const deps={db,providers,limits:app.DEFAULT_LIMITS,tokenHash,expiresAt:String(now+3600000),now:()=>now,send};
 const request=(body,auth=token)=>new Request('https://site.test/api/archindus/evaluate',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});
 assert.equal((await app.handleQualityTrial(request({action:'start'},'wrong'),deps)).status,401);assert.equal((await app.handleQualityTrial(request({action:'start'}),{...deps,expiresAt:String(now-1)})).status,401);
 assert.equal((await app.handleQualityTrial(request({action:'start',prompt:'private prompt'}),deps)).status,400);assert.equal(generations,0);
 const started=await (await app.handleQualityTrial(request({action:'start'}),deps)).json();assert.equal(started.maximumCalls,24);assert.equal((await (await app.handleQualityTrial(request({action:'start'}),deps)).json()).runId,started.runId);assert.equal(generations,0);assert.doesNotMatch(JSON.stringify(started),/test-trial-key/);
 const body={action:'case',runId:started.runId,caseId:'extract-person',arm:'champion'};const result=await (await app.handleQualityTrial(request(body),deps)).json();assert.equal(result.observation.arm,'shared');assert.equal(result.observation.passed,true);assert.match(result.observation.outputHash,/^[a-f0-9]{64}$/);assert.equal(generations,1);
 const replay=await (await app.handleQualityTrial(request({...body,arm:'challenger'}),deps)).json();assert.equal(replay.reused,true);assert.equal(generations,1);assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_usage').first()).n,1);
 const stored=await db.prepare('SELECT result FROM routing_quality_results').first();assert.doesNotMatch(stored.result,/Ada|Lovelace|notebooks/);
 const report=await (await app.handleQualityTrial(request({action:'report',runId:started.runId}),deps)).json();assert.equal(report.summary.matchedCases,1);assert.equal(report.summary.holdoutSamples,0);
 assert.equal((await app.handleQualityTrial(request({...body,model:'paid-model'}),deps)).status,400);assert.equal(generations,1);
 await app.pauseProvider(db,60,now,'groq');assert.equal((await app.handleQualityTrial(request({...body,caseId:'pens'}),deps)).status,429);assert.equal(generations,1);assert.equal(await db.prepare("SELECT id FROM routing_quality_results WHERE case_id='pens'").first(),null);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
