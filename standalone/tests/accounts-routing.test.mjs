import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {openSqlite} from './helpers/sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');
await build({stdin:{contents:["export * from './lib/account'","export * from './lib/inference/models'","export {quickReply} from './app/archindus/orchestration'","export {handleHosted} from './lib/inference/hosted'","export {DEFAULT_LIMITS} from './lib/inference/budget'"].join(';'),resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(root,'outputs/account-tests.mjs'),logLevel:'silent'});
const app=await import('../outputs/account-tests.mjs');
const directory=await mkdtemp(path.join(root,'outputs/accounts-'));
const db=openSqlite(path.join(directory,'accounts.sqlite'));
db.batch=async statements=>{await db.prepare('BEGIN').run();try{const out=[];for(const stmt of statements)out.push(await stmt.run());await db.prepare('COMMIT').run();return out}catch(e){await db.prepare('ROLLBACK').run();throw e}};
const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
for(const entry of journal.entries)for(const statement of (await readFile(path.join(root,'drizzle',entry.tag+'.sql'),'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
after(async()=>{db.close();await rm(directory,{recursive:true,force:true})});
const versions=new Map();
function request(user,path='',method='GET',body,origin='https://site.test'){
 return new Request('https://site.test/api/account'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}),...(body===undefined?{}:{'content-type':'application/json',origin,'x-archindus-account-version':versions.get(user)??''})},body:body===undefined?undefined:JSON.stringify(body)});
}
const call=async(...args)=>{const response=await app.handleAccount(request(...args),db);if(!args[1]&&(!args[2]||args[2]==='GET')&&args[0]){const data=await response.clone().json();if(data.user)versions.set(args[0],data.user.version)}return response};
test('every account data route requires identity and mutations require the same origin',async()=>{
 assert.equal((await (await call(null)).json()).authenticated,false);
 for(const path of ['/export','/conversations','/memories','/personalities'])assert.equal((await call(null,path)).status,401);
 assert.equal((await call('alice','','PATCH',{},'https://foreign.test')).status,403);
 await call('alice');
 assert.equal((await call('alice','','PATCH',{...app.DEFAULT_SETTINGS,userId:'bob'})).status,400);
 assert.equal((await app.handleAccount(request('alice'),undefined)).status,503);
});
test('profiles, memories, conversations and exports remain isolated across two users',async()=>{
 const a=await (await call('alice')).json();await call('bob');
 const settings={...a.settings,instructions:'Use metric units.',displayName:'Alice',modelPolicy:'economy'};
 assert.equal((await call('alice','','PATCH',settings)).status,200);
 const memory=await (await call('alice','/memories','POST',{content:'Project codename is Orion.'})).json();
 assert.equal((await call('bob','/memories','PATCH',{id:memory.id,content:'Stolen edit'})).status,404);
 assert.equal((await call('alice','/memories','PATCH',{id:memory.id,content:'Project codename is Orion. Keep this private.'})).status,200);
 const id=crypto.randomUUID(),messages=[{id:crypto.randomUUID(),role:'user',content:'Private brief',status:'complete'}];
 assert.equal((await call('alice','/conversations/'+id,'PUT',{messages})).status,200);
 assert.equal((await call('bob','/conversations/'+id)).status,404);
 assert.equal((await call('bob','/conversations/'+id,'PUT',{messages})).status,409);
 await call('bob','/memories','DELETE',{id:memory.id});
 const exported=await (await call('alice','/export')).json();
 assert.equal(exported.memories.length,1);assert.equal(exported.conversations[0].messages[0].content,'Private brief');
 const bob=await (await call('bob','/export')).json();assert.equal(bob.memories.length,0);assert.equal(bob.conversations.length,0);assert.equal(bob.settings.instructions,'');
 assert.equal((await call('alice','/conversations/'+id,'PUT',{messages:[{...messages[0],content:'x'.repeat(16001)}]})).status,400);
});
test('memory controls and temporary chats prevent memory egress; history off prevents writes',async()=>{
 const identity={id:'alice',email:'alice@example.test',name:''};
 const personal=await app.accountPersonalization(db,identity,false);assert.match(personal.personalContext,/Orion/);assert.equal(personal.modelPolicy,'economy');
 const temporary=await app.accountPersonalization(db,identity,true);assert.equal(temporary.personalContext,undefined);assert.equal(temporary.modelPolicy,'economy');
 const a=await (await call('alice')).json();
 await call('alice','','PATCH',{...a.settings,memoryEnabled:false,historyEnabled:false});
 assert.doesNotMatch((await app.accountPersonalization(db,identity,false)).personalContext,/Orion/);
 assert.equal((await call('alice','/memories','POST',{content:'Do not save'})).status,409);
 assert.equal((await call('alice','/conversations/'+crypto.randomUUID(),'PUT',{messages:[{id:'1',role:'user',content:'Do not save',status:'complete'}]})).status,409);
 const exported=await (await call('alice','/export')).json();assert.equal(exported.memories.length,1,'Disabling memory is distinct from deleting it.');
});
let ownedPersonality;
test('personalities have owned CRUD, validation, export, and an atomic twenty-personality cap',async()=>{
 const draft={name:'Atlas',description:'Practical research',instructions:'End with one practical next step.',capability:'satoshi',modelPolicy:'quality'};
 const created=await call('alice','/personalities','POST',draft);assert.equal(created.status,201);ownedPersonality=(await created.json()).personality;
 assert.equal((await call('alice','/personalities','POST',{...draft,capability:'unknown'})).status,400);
 assert.equal((await call('alice','/personalities','POST',{...draft,instructions:'x'.repeat(2401)})).status,400);
 assert.equal((await call('bob','/personalities/'+ownedPersonality.id,'PATCH',draft)).status,404);
 await call('bob','/personalities/'+ownedPersonality.id,'DELETE',{});
 assert.equal((await (await call('bob','/personalities')).json()).personalities.length,0);
 assert.equal((await call('alice','/personalities/'+ownedPersonality.id,'PATCH',draft)).status,200);
 assert.equal((await (await call('alice','/export')).json()).personalities[0].id,ownedPersonality.id);
 const results=await Promise.all(Array.from({length:20},()=>call('alice','/personalities','POST',draft)));
 assert.equal(results.filter(r=>r.status===201).length,19);assert.equal(results.filter(r=>r.status===409).length,1);
 assert.equal((await (await call('alice','/personalities')).json()).personalities.length,20);
});
test('owned personality controls the actual model and prompt, including explicit temporary selection',async()=>{
 let payload,calls=0;
 const run=(user,temporary,id=ownedPersonality.id)=>app.handleHosted(new Request('https://site.test/api/archindus/hosted',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),action:'generate',selectedAgentId:'architect',objective:'Explain this approach',history:[],temporary,personalityId:id})}),{key:'test-key',enabled:true,db,limits:app.DEFAULT_LIMITS,personalize:(t,id)=>app.accountPersonalization(db,{id:user,name:'',email:''},t,id),fetch:async(_url,init)=>{calls++;payload=JSON.parse(init.body);return Response.json({choices:[{message:{content:'I am Archindus. Here is one practical next step.'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})}});
 assert.equal((await run('alice',false)).status,200);assert.equal(payload.model,'gpt-6-astra');assert.match(payload.messages[0].content,/End with one practical next step/);assert.match(payload.messages[0].content,/identity.*Archindus/i);
 assert.equal((await run('alice',true)).status,200);assert.match(payload.messages[0].content,/End with one practical next step/);assert.doesNotMatch(payload.messages[0].content,/Use metric units/);
 const before=calls;assert.equal((await run('bob',false)).status,404);assert.equal((await run('alice',false,crypto.randomUUID())).status,404);assert.equal(calls,before);
});
test('explicit account deletion removes only the current user data atomically',async()=>{
 assert.equal((await call('alice','','DELETE',{confirm:'wrong'})).status,400);
 assert.equal((await call('alice','','DELETE',{confirm:'DELETE'})).status,200);
 for(const table of ['account_profiles','account_memories','account_conversations','account_personalities'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).bind('alice').first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM account_profiles WHERE user_id=?').bind('bob').first()).n,1);
 assert.equal((await call('alice','/conversations/'+crypto.randomUUID(),'PUT',{messages:[{id:'stale',role:'user',content:'Deleted data must not return',status:'complete'}]})).status,401);
 const old=versions.get('alice');await call('alice');const current=versions.get('alice');assert.notEqual(current,old);
 versions.set('alice',old);assert.equal((await call('alice','/memories','POST',{content:'Stale tab'})).status,409);versions.set('alice',current);
});
test('routing selects the cheapest capable tier, preserves explicit policy, and every greeting identifies Archindus',()=>{
 const plan=(task,primaryId='architect')=>({task,primaryId});
 assert.equal(app.selectTextModel('What is a sunset?',plan('chat')).id,'gpt-6-luna');
 assert.equal(app.selectTextModel('Summarize this report',plan('document','datadoc')).id,'gpt-6.1-terra');
 assert.equal(app.selectTextModel('Write a function',plan('code','satoshi')).id,'gpt-6.1-sol');
 assert.equal(app.selectTextModel('Give a rigorous proof',plan('chat','socrates')).id,'gpt-6-astra');
 assert.equal(app.selectTextModel('Give a rigorous proof',plan('chat'),'economy').id,'gpt-6-luna');
 assert.equal(app.selectTextModel('Hello there',plan('chat'),'quality').id,'gpt-6-astra');
 for(const id of ['satoshi','socrates','ounumi','datadoc','wolf'])assert.match(app.quickReply('Hello',id,[]).text,/I'm Archindus/);
 for(const m of app.MODEL_CATALOG)assert.ok(app.textCost(100,100,m)>=100*m.input+100*m.output);
 const sol=app.MODEL_CATALOG[2];
 assert.equal(app.textUsageCost({prompt_tokens:100,completion_tokens:40,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0}},sol),600);
 assert.equal(app.textUsageCost({prompt_tokens:100,completion_tokens:40,prompt_tokens_details:{cached_tokens:50,cache_write_tokens:50}},sol),530);
});
test('server applies owned personalization and temporary flag before model selection, keeping model IDs bounded',async()=>{
 let payload,temporaryFlag;
 const deps={key:'test-key',enabled:true,db,limits:app.DEFAULT_LIMITS,personalize:async temporary=>{temporaryFlag=temporary;return temporary?{modelPolicy:'economy'}:{modelPolicy:'quality',personalContext:'Reference memory: Orion.'}},fetch:async(_url,init)=>{payload=JSON.parse(init.body);return Response.json({choices:[{message:{content:'I am Archindus.'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:5}})}};
 const run=temporary=>app.handleHosted(new Request('https://site.test/api/archindus/hosted',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),action:'generate',selectedAgentId:'architect',objective:'Who are you?',history:[],temporary})}),deps);
 assert.equal((await run(false)).status,200);assert.equal(payload.model,'gpt-6-astra');assert.match(payload.messages[0].content,/Orion/);
 assert.equal((await run(true)).status,200);assert.equal(temporaryFlag,true);assert.equal(payload.model,'gpt-6-luna');assert.doesNotMatch(payload.messages[0].content,/Orion/);
});
