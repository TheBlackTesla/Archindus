import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {openSqlite} from './helpers/sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');
await build({stdin:{contents:["export * from './lib/inference/voice'","export * from './app/archindus/voice-playback'","export * from './app/archindus/voice-config'"].join(';'),resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(root,'outputs/voice-tests.mjs'),logLevel:'silent'});
const app=await import('../outputs/voice-tests.mjs'),directory=await mkdtemp(path.join(root,'outputs/voice-')),db=openSqlite(path.join(directory,'voice.sqlite'));
const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
for(const entry of journal.entries)for(const sql of (await readFile(path.join(root,'drizzle',entry.tag+'.sql'),'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
after(async()=>{db.close();await rm(directory,{recursive:true,force:true})});
const request=(body={text:'Hello from Archindus.'},user='alice',origin='https://site.test',signal)=>new Request('https://site.test/api/archindus/voice',{method:'POST',headers:{origin,'content-type':'application/json',...(user?{'oai-authenticated-user-id':user}:{})},body:JSON.stringify(body),signal});
const mp3=()=>new Response(new Uint8Array([73,68,51,4,0,0,0,0]),{headers:{'Content-Type':'audio/mpeg'}});
const deps=fetch=>({key:'test-voice-secret',db,fetch});
test('voice authentication, origin, strict body and server credential are required before paid calls',async()=>{
 let calls=0;const d=deps(async()=>{calls++;return mp3()});
 assert.equal((await app.handleVoice(request(undefined,null),d)).status,401);
 assert.equal((await app.handleVoice(request(undefined,'alice','https://foreign.test'),d)).status,403);
 assert.equal((await app.handleVoice(request(),{db})).status,503);
 for(const body of [{text:''},{text:'x'.repeat(2401)},{text:'hello',voice_id:'another-voice'},{text:'hello',model_id:'expensive'}])assert.equal((await app.handleVoice(request(body),d)).status,400);
 assert.equal(calls,0);const status=await app.voiceStatus(d).json();assert.equal(status.voiceId,'8FWNPj6rjBosEZ2EXARh');assert.equal(status.configured,true);assert.doesNotMatch(JSON.stringify(status),/test-voice-secret/);
});
test('speech uses the exact configured voice and server-only key, returns bounded audio and stores no speech',async()=>{
 let url,payload,key;const text='A private answer from Archindus.';
 const r=await app.handleVoice(request({text}),deps(async(u,init)=>{url=u;payload=JSON.parse(init.body);key=init.headers['xi-api-key'];return mp3()}));
 assert.equal(r.status,200);assert.match(url,/8FWNPj6rjBosEZ2EXARh/);assert.equal(payload.model_id,'eleven_flash_v2_5');assert.equal(payload.text,text);assert.equal(key,'test-voice-secret');assert.equal(r.headers.get('Content-Type'),'audio/mpeg');assert.equal(r.headers.get('Cache-Control'),'no-store');
 const row=await db.prepare('SELECT * FROM voice_usage').first();assert.equal(row.active_until,0);assert.notEqual(row.user_id,'alice');assert.equal(row.characters,Array.from(text).length);assert.doesNotMatch(JSON.stringify(row),/private answer/);
});
test('invalid or oversized provider audio and upstream failures do not expose keys or raw errors',async()=>{
 const cases=[Response.json({detail:'secret provider diagnostic'}),new Response('not audio',{headers:{'Content-Type':'audio/mpeg'}}),new Response(new Uint8Array(app.VOICE_AUDIO_LIMIT+1),{headers:{'Content-Type':'audio/mpeg'}}),Response.json({detail:'sensitive'},{status:401})];
 for(let i=0;i<cases.length;i++){const r=await app.handleVoice(request({text:'A test'},'bad-audio-'+i),deps(async()=>cases[i]));assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/test-voice-secret|secret provider diagnostic|sensitive/)}
});
test('atomic voice reservations bound concurrent requests and daily characters before upstream execution',async()=>{
 await db.prepare('DELETE FROM voice_usage').run();let calls=0;
 const now=Date.parse('2026-11-06T12:00:00Z'),day='2026-11-06',month='2026-11';
 await db.prepare('INSERT INTO voice_usage(id,user_id,day,month,characters,created_at,active_until) VALUES (?,?,?,?,?,?,?)').bind('quota','hash',day,month,9900,now,0).run();
 const r=await app.handleVoice(request({text:'x'.repeat(101)}),{...deps(async()=>{calls++;return mp3()}),now:()=>now});assert.equal(r.status,429);assert.equal(calls,0);
 await db.prepare('DELETE FROM voice_usage').run();let release;const pending=new Promise(resolve=>release=resolve);
 const d={...deps(async()=>{calls++;await pending;return mp3()}),now:()=>now};
 const first=app.handleVoice(request({text:'hello'},'one'),d),second=app.handleVoice(request({text:'hello'},'two'),d);
 // Async reservations settle before upstream transport yields this signal.
 await new Promise(resolve=>setImmediate(resolve));
 const third=await app.handleVoice(request({text:'hello'},'three'),d);assert.equal(third.status,429);release();assert.equal((await first).status,200);assert.equal((await second).status,200);assert.equal(calls,2);
});
class AudioDouble{pauseCount=0;onplaying;onended;onerror;async play(){this.onplaying?.()}pause(){this.pauseCount++}removeAttribute(){}load(){}}
test('playback reuses the same clip without another charge and stop revokes object URLs',async()=>{
 let calls=0,starts=0;const revoked=[],audio=[];
 const player=new app.VoicePlayback(async()=>{calls++;return mp3()},()=>{const a=new AudioDouble();audio.push(a);return a},{createObjectURL:()=> 'blob:voice-'+audio.length,revokeObjectURL:u=>revoked.push(u)});
 await player.speak('Hello',()=>starts++,()=>{});await player.speak('Hello',()=>starts++,()=>{});assert.equal(calls,1);assert.equal(starts,2);assert.equal(audio[0].pauseCount,1);assert.equal(revoked.length,1);player.stop();assert.equal(revoked.length,2);player.clear();await player.speak('Hello',()=>{},()=>{});assert.equal(calls,2);player.stop();
});
test('stopping a pending voice request prevents late audio playback',async()=>{
 let release,signal,created=0;const ready=new Promise(resolve=>release=resolve);
 const player=new app.VoicePlayback(async(_u,init)=>{signal=init.signal;await ready;return mp3()},()=>{created++;return new AudioDouble()},{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}});
 const pending=player.speak('Old answer',()=>{},()=>{});player.stop();assert.equal(signal.aborted,true);release();await pending;assert.equal(created,0);
});
