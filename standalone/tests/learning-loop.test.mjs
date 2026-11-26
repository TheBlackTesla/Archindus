import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {openSqlite} from './helpers/sqlite.mjs';
await build({stdin:{contents:['lib/inference/learning-policy','lib/inference/metrics','lib/inference/adaptive','app/archindus/routing-receipt'].map(f=>`export * from './${f}'`).join(';'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'outputs/learning-test.mjs',logLevel:'silent'});const app=await import('../outputs/learning-test.mjs');
test('the champion exactly preserves the previous operational scoring formula',()=>{
 for(let n=0;n<=200;n++){
  const row={n,s:Math.floor(n*.7),ms:n*3210,charged:n*100,unknownUsage:0};const legacy=n<5?0:Math.max(-.25,Math.min(.15,((row.s+5)/(n+10)-.5)*.5-Math.min(.05,row.ms/n/1200000)));
  assert.equal(app.baselineScore(row),legacy);
 }
});
test('confidence policy requires evidence and handles malformed aggregates neutrally',()=>{
 const row={n:100,s:90,ms:100000,charged:0,unknownUsage:0};assert.ok(app.confidenceScore(row)>0);assert.equal(app.confidenceScore({...row,n:5,s:5}),0);
 for(const patch of [{s:101},{n:NaN},{ms:-1},{unknownUsage:101},{charged:NaN}])assert.equal(app.confidenceScore({...row,...patch}),0);
 assert.ok(app.confidenceScore({...row,unknownUsage:100})<app.confidenceScore(row));
});
test('fixed challenger fixtures preserve free-first routing, personal influence and deterministic cold starts',async()=>{
 const fixtures=JSON.parse(await readFile('tests/fixtures/routing-learning.json','utf8'));
 for(const f of fixtures)assert.equal(app.policyOrder(f.routes,app.SHADOW_ROUTING_POLICY)[0],f.expected,f.name);
 for(let i=0;i<100;i++)assert.equal(app.policyOrder([{id:'paid',free:false,base:i,evidence:null},{id:'free',free:true,base:-i,evidence:null}],app.SHADOW_ROUTING_POLICY)[0],'free');
});
test('promotion rejects missing quality evidence and regressions, rather than treating shadow counts as quality',()=>{
 const good={regressions:0,qualitySamples:250,qualityLowerBound:.02,costRatio:1,latencyRatio:1};assert.equal(app.promotionGate(good).eligible,true);
 for(const patch of [{regressions:1},{qualitySamples:199},{qualityLowerBound:-.01},{qualityLowerBound:NaN},{costRatio:1.06},{latencyRatio:1.11},{qualityLowerBound:0}])assert.equal(app.promotionGate({...good,...patch}).eligible,false);
});
test('shadow disagreement is recorded without changing the served policy or making extra inference calls',async()=>{
 const dir=await mkdtemp(path.join(process.cwd(),'outputs/shadow-')),db=openSqlite(path.join(dir,'db.sqlite'));const now=Date.now();
 try{
 const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const e of journal.entries)for(const sql of (await readFile('drizzle/'+e.tag+'.sql','utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const day=new Date(now).toISOString().slice(0,10);
 for(const [model,n,s] of [['lucky:free',5,5],['established:free',100,65]])await db.prepare('INSERT INTO routing_model_metrics VALUES(?,?,?,?,?,?,?,?,?)').bind('openrouter',model,'chat',day,n,s,n*1000,0,0).run();
 const models=['lucky:free','established:free'].map(id=>({provider:{id:'openrouter',name:'OpenRouter'},model:{id,name:id,input:0,output:0}}));const calls=[];
 const result=await app.adaptiveOrder(models,new Request('https://site.test'),db,'chat',true,async(url,init)=>{calls.push(String(url));assert.equal(init?.body,undefined);return Response.json({data:[],rows:[]})},now);
 assert.equal(result[0].model.id,'lucky:free','Champion still serves the real response');
 const row=await db.prepare('SELECT * FROM routing_policy_shadow').first();assert.equal(row.decisions,1);assert.equal(row.disagreements,1);assert.equal(row.champion,'operational-v1');assert.equal(row.challenger,'confidence-v2');assert.ok(calls.every(url=>!url.includes('chat/completions')));
 await app.recordShadowDecision(db,'chat',false,now);assert.equal((await db.prepare('SELECT decisions FROM routing_policy_shadow').first()).decisions,2);
 await db.prepare("INSERT INTO routing_policy_shadow VALUES('2000-01-01','chat','old','old',1,1)").run();await app.recordShadowDecision(db,'chat',false,now);assert.equal(await db.prepare("SELECT * FROM routing_policy_shadow WHERE day='2000-01-01'").first(),null);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('routing receipts preserve policy versions and remain compatible with older chats',()=>{
 const attempts=[{model:'Example',outcome:'complete',elapsedMs:1,reservedMicrodollars:0}];assert.deepEqual(app.readReceipt({attempts}),{attempts});
 const receipt={attempts,policyVersion:app.ACTIVE_ROUTING_POLICY,shadowPolicyVersion:app.SHADOW_ROUTING_POLICY};assert.deepEqual(app.readReceipt(receipt),receipt);
});
