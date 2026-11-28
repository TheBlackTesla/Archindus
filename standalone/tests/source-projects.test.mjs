import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {openSqlite} from './helpers/sqlite.mjs';
const root=process.cwd();
await build({stdin:{contents:"export * from './app/archindus/evidence';export * from './lib/account';export * from './lib/inference/model-checks';export * from './lib/inference/budget';export * from './lib/email-auth'",resolveDir:root},bundle:true,packages:'external',format:'esm',platform:'node',outfile:'outputs/source-project-tests.mjs',logLevel:'silent'});
const api=await import('../outputs/source-project-tests.mjs');
function source(id,commit){return {id:crypto.randomUUID(),name:id+'.pdf',text:commit,truncated:false,pages:['Opening section. '.repeat(200),'We will deliver the pilot within '+commit+'.']}}
test('page-specific retrieval ranks matching delivery terms and withholds incompatible comparisons',()=>{
 const a=source('A','17 calendar days of written authorization'),b=source('B','23 calendar days of written authorization');
 const result=api.buildBrief('Which delivery commitment is sooner?',[a,b]);
 assert.match(result.summary,/6 days sooner/);assert.ok(result.findings.filter(f=>/deliver the pilot/.test(f.text)).every(f=>result.sources[f.source].page===2));assert.match(api.evidenceContext('delivery commitment',[a,b]),/23 calendar days/);
 for(const changed of ['23 business days of written authorization','23 calendar days after payment'])assert.match(api.buildBrief('Which delivery commitment is sooner?',[a,source('B',changed)]).summary,/cannot be ranked/);
 assert.match(api.buildBrief('Which delivery commitment is sooner?',[a,source('B','timetable to be determined')]).summary,/incomplete/);
 const csv={...a,name:'sample.csv',pages:undefined,text:'Vendor,Code\nNorth,AA\nSouth,BB'};
 assert.equal(api.retrieveEvidence('South',[csv])[0].location,'Row 3');
});
const db=openSqlite(':memory:');
db.batch=async rows=>Promise.all(rows.map(r=>r.run()));
for(const entry of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)for(const s of (await readFile('drizzle/'+entry.tag+'.sql','utf8')).split('--> statement-breakpoint'))if(s.trim())await db.prepare(s).run();
const objects=new Map(),bucket={put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{text:async()=>objects.get(k)}:null,delete:async k=>{for(const x of [k].flat())objects.delete(x)}};
const versions={};
const account=(name,path='',method='GET',body)=>api.handleAccount(new Request('https://site.test/api/account'+path,{method,headers:{'oai-authenticated-user-id':name,'x-archindus-account-version':versions[name]??'',origin:'https://site.test','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),db,{bucket});
test('original project bytes and citations survive reopen; edits are revision-checked and owner-scoped',async()=>{
 for(const user of ['owner','second'])versions[user]=(await (await account(user)).json()).user.version;
 const id=crypto.randomUUID(),path='/projects/'+id,doc={id:crypto.randomUUID(),name:'a.txt',data:btoa('Pilot report')};
 const bundle={title:'Pilot',revision:null,files:[doc],briefs:[]};
 const first=await account('owner',path,'PUT',bundle);assert.equal(first.status,200);
 const saved=await (await account('owner',path)).json();assert.deepEqual(saved.files,[doc]);
 assert.equal((await account('second',path)).status,404);assert.equal((await account('second',path,'PUT',bundle)).status,409);
 assert.equal((await account('owner',path,'PUT',{...bundle,title:'stale'})).status,409);
 assert.equal((await account('owner',path,'PUT',{...saved,title:'updated'})).status,200);
 assert.equal(objects.size,1);assert.equal((await account('owner',path,'DELETE',{})).status,200);assert.equal(objects.size,0);
});
test('email codes exchange through Supabase with the chosen purpose and never return session tokens',async()=>{
 const requests=[],client={auth:{verifyOtp:async input=>{requests.push(input);return {data:{user:{email_confirmed_at:'verified'},session:{access_token:'private'}},error:null}}}};
 const run=async purpose=>api.handleEmailAuth(new Request('https://site.test/api/auth/verify-code',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:JSON.stringify({email:'case@example.test',token:'12345678',purpose})}),{},client);
 assert.deepEqual(await (await run('signup')).json(),{signedIn:true});assert.deepEqual(await (await run('recovery')).json(),{resetRequired:true});assert.deepEqual(requests.map(v=>v.type),['email','recovery']);
});
test('paid verification uses only fixed, once-per-day tests after an operator arms the date',async()=>{
 const now=Date.UTC(2026,10,25),day='2026-11-25',target='gpt-6.2-sol';let n=0;
 const request=()=>new Request('https://site.test/api/archindus/checks',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:JSON.stringify({target})});
 const deps={enabled:true,key:'unit-test',db,limits:api.DEFAULT_LIMITS,now:()=>now,fetch:async(_u,init)=>{n++;assert.equal(JSON.parse(init.body).model,target);return Response.json({model:target,usage:{prompt_tokens:70,completion_tokens:35},choices:[{finish_reason:'stop',message:{content:'\x60\x60\x60json\n{"code":"function add(a,b){return a+b;}"}\n\x60\x60\x60'}}]})}};
 assert.equal((await api.modelChecks(request(),db,deps,'')).status,403);
 assert.equal((await (await api.modelChecks(request(),db,deps,day)).json()).outcome,'passed');
 assert.equal((await (await api.modelChecks(request(),db,deps,day)).json()).outcome,'already_checked');assert.equal(n,1);
});

test('changing memory and history preserves independently saved instructions', async () => {
 const user='settings-owner';
 versions[user]=(await (await account(user)).json()).user.version;
 const update=async values=>(await (await account(user,'','PATCH',values)).json()).settings;
 await update({instructions:'Keep the draft review checklist.'});
 const disabled=await update({memoryEnabled:false});
 assert.equal(disabled.instructions,'Keep the draft review checklist.');
 assert.equal(disabled.memoryEnabled,false);
 const enabled=await update({memoryEnabled:true,historyEnabled:false});
 assert.equal(enabled.instructions,disabled.instructions);
 assert.equal(enabled.memoryEnabled,true);
 assert.equal(enabled.historyEnabled,false);
});

test('a conflicting clause outside the top search passages blocks a ranking and is cited', () => {
  const a = source('A','17 calendar days of written authorization');
  a.pages.push(
    ...Array(5).fill('Delivery commitments and deadlines. Ask which delivery deadline is sooner.'),
    'Final appendix. We will deliver the pilot within 31 calendar days of written authorization.'
  );
  const b = source('B','23 calendar days of written authorization');
  const brief = api.buildBrief('Which delivery commitment is sooner?',[a,b]);
  assert.equal(brief.decisionBlocked,true);
  assert.match(brief.summary,/conflict/);
  const lateTerm = brief.findings.find(f => f.text.includes('31 calendar days'));
  assert.equal(brief.sources[lateTerm.source].page,a.pages.length);
  assert.ok(brief.findings.some(f => f.text.includes('17 calendar days')));
});

test('scanned, missing, and unreadable PDF pages prevent a definitive ranking', () => {
  const a = source('A','17 calendar days of written authorization');
  const b = source('B','23 calendar days of written authorization');
  for (const [pages,note] of [
    [[...a.pages,'  '],/no readable text on PDF pages 3.*OCR/],
    [[a.pages[0],a.pages[1]+'\nPage 2 of 3'],/missing or out-of-order/],
    [['',''],/no readable text on PDF pages 1, 2/],
  ]) {
    const brief = api.buildBrief('Which delivery commitment is sooner?',[{...a,pages},b]);
    assert.equal(brief.decisionBlocked,true);
    assert.match(brief.summary,/incomplete/);
    assert.match(brief.review.join(' '),note);
  }
});

test('delivery evidence treats same-name sources separately and flags conditional commitments', () => {
  const a = source('proposal','17 calendar days of written authorization');
  const b = source('proposal','23 calendar days of written authorization');
  const question = 'Which delivery commitment is sooner?';
  a.pages[1] = 'Delivery commitment Proposal A / Standard implementation ' + a.pages[1];
  b.pages[1] = 'Delivery commitment Proposal B / Extended handover ' + b.pages[1];
  assert.match(api.buildBrief(question,[a,b]).summary,/\(source 1\).*6 days sooner/);
  b.pages[1] = 'We will deliver the full production system within 23 calendar days of written authorization.';
  assert.match(api.buildBrief(question,[a,b]).review.join(' '),/different units, starting conditions, or deliverables/);
  b.pages[1] = 'We estimate we will deliver the pilot within 23 calendar days of written authorization.';
  assert.equal(api.buildBrief(question,[a,b]).decisionBlocked,true);
});

test('only checked text unlocks scanned pages and corrections update the page citation', () => {
  const a = source('A','17 calendar days of written authorization');
  const b = {...source('scan',''),pages:[' \n','Page 2 of 2']};
  const question = 'Which delivery commitment is sooner?';
  const first = {page:1,text:'The project includes a document intake pilot.'};
  const second = {page:2,text:'We will deliver the pilot within 23 calendar days of written authorization.'};
  const brief = reviews => api.buildBrief(question,[a,{...b,reviewedPages:reviews}]);
  assert.equal(brief([]).decisionBlocked,true);
  assert.equal(brief([first]).decisionBlocked,true);
  assert.equal(brief([second]).decisionBlocked,true);
  const checked = brief([first,second]);
  assert.equal(checked.decisionBlocked,false);
  assert.match(checked.summary,/6 days sooner/);
  const finding = checked.findings.find(f=>f.text.includes('23 calendar'));
  assert.equal(checked.sources[finding.source].location,'Page 2 · reviewed transcription');
  assert.equal(checked.sources[finding.source].page,2);
  assert.match(brief([first,{...second,text:second.text.replace('23','25')}]).summary,/8 days sooner/);
  assert.equal(brief([first,{...second,text:'Page 2 of 2'}]).decisionBlocked,true);
  const missing = {...b,pages:['','Page 3 of 3'],reviewedPages:[first,second]};
  assert.match(api.buildBrief(question,[a,missing]).review.join(' '),/missing or out-of-order/);
  const forged = {...a,reviewedPages:[{page:2,text:second.text.replace('23','105')}]};
  assert.match(api.buildBrief(question,[forged,{...b,reviewedPages:[first,second]}]).summary,/6 days sooner/);
});

test('saved projects round-trip checked transcriptions and reject duplicate or invalid page entries', async () => {
  const user = 'scan-owner';
  versions[user] = (await (await account(user)).json()).user.version;
  const id=crypto.randomUUID(), path='/projects/'+id;
  const original=await readFile('public/examples/proposal-b-scan.pdf');
  const entry={id:crypto.randomUUID(),name:'scan.pdf',data:original.toString('base64'),reviewedPages:[{page:2,text:'We will deliver the pilot within 23 calendar days of written authorization.'}]};
  const value={title:'Scanned project',revision:null,files:[entry],briefs:[]};
  assert.equal((await account(user,path,'PUT',value)).status,200);
  const saved=await (await account(user,path)).json();
  assert.deepEqual(saved.files,[entry]);
  for (const invalid of [
    {...entry,reviewedPages:[...entry.reviewedPages,...entry.reviewedPages]},
    {...entry,name:'scan.txt'}, {...entry,reviewedPages:[{page:0,text:'Clause'}]},
    {...entry,reviewedPages:[{page:2,text:'   '}]},
  ]) assert.equal((await account(user,path,'PUT',{...saved,files:[invalid]})).status,400);
  assert.deepEqual((await (await account(user,path)).json()).files,[entry]);
  await account(user,path,'DELETE',{});
});

test('a qualified clause survives a duplicate unconditional clause on another page', () => {
  const a=source('A','17 calendar days of written authorization');
  a.pages.splice(1,0,'We estimate we will deliver the pilot within 17 calendar days of written authorization.');
  const brief=api.buildBrief('Which proposal delivers sooner?',[a,source('B','23 calendar days of written authorization')]);
  assert.equal(brief.decisionBlocked,true);
  assert.match(brief.review.join(' '),/estimate, condition, or qualification/);
  const qualification=brief.findings.find(f=>f.text.includes('estimate'));
  assert.equal(brief.sources[qualification.source].page,2);
});
