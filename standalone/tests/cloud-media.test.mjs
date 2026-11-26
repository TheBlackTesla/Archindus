import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {openSqlite} from './helpers/sqlite.mjs';
const root=new URL('../',import.meta.url).pathname;
await build({stdin:{contents:"export * from './lib/inference/cloud-media'",resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',outfile:root+'outputs/cloud-media-tests.mjs',logLevel:'silent'});
const {handleCloudMedia}=await import('../outputs/cloud-media-tests.mjs');
const folder=await mkdtemp(root+'outputs/media-'),db=openSqlite(folder+'/usage.sqlite');
const journal=JSON.parse(await readFile(root+'drizzle/meta/_journal.json','utf8'));
for(const entry of journal.entries)for(const sql of (await readFile(root+'drizzle/'+entry.tag+'.sql','utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
after(async()=>{db.close();await rm(folder,{recursive:true,force:true})});
const request=(body,origin='https://site.test')=>new Request('https://site.test/api/archindus/cloud-media',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const deps={values:{HF_TOKEN:'test-secret',ARCHINDUS_HOSTED_ENABLED:'true'},db,limits:{day:1000000,month:10000000}};
test('media rejects foreign origins, arbitrary model parameters and zero budgets before calling provider',async()=>{
 let calls=0;const generate=async()=>{calls++;return new Blob()};
 assert.equal((await handleCloudMedia(request({kind:'video',prompt:'test'},'https://evil.test'),{...deps,generate})).status,403);
 assert.equal((await handleCloudMedia(request({kind:'video',prompt:'test',model:'expensive'}),{...deps,generate})).status,400);
 assert.equal((await handleCloudMedia(request({kind:'video',prompt:'test'}),{...deps,limits:{day:0,month:0},generate})).status,429);
 assert.equal(calls,0);
});
test('video returns binary with truthful model metadata and retains its cost reservation',async()=>{
 const bytes=new Uint8Array(32);bytes.set([102,116,121,112],4);
 const r=await handleCloudMedia(request({kind:'video',prompt:'test'}),{...deps,generate:async()=>new Blob([bytes],{type:'video/mp4'})});
 assert.equal(r.status,200);assert.match(r.headers.get('X-Archindus-Model'),/Wan2.2/);
 const row=await db.prepare("SELECT charged,active_until FROM inference_usage WHERE kind='video' ORDER BY rowid DESC LIMIT 1").first();
 assert.equal(row.charged,250000);assert.equal(row.active_until,0);
});
test('malformed media and provider errors do not leak credentials',async()=>{
 const r=await handleCloudMedia(request({kind:'image',prompt:'test'}),{...deps,generate:async()=>{throw Error('test-secret')}});
 assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/test-secret/);
});
