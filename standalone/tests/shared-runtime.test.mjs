import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('../outputs',import.meta.url),{recursive:true});
await build({entryPoints:[new URL('../lib/inference/shared-runtime.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outfile:new URL('../outputs/shared-runtime.mjs',import.meta.url).pathname,logLevel:'silent'});
const {relayRuntime,SHARED_RUNTIME_ORIGIN}=await import('../outputs/shared-runtime.mjs');
const post=(body='{}',headers={})=>new Request('https://standalone.example/api/archindus/hosted',{method:'POST',headers:{origin:'https://standalone.example','content-type':'application/json',...headers},body});
test('rejects cross-origin, wrong methods and oversized input without calling the service',async()=>{
 let calls=0;const send=async()=>{calls++;return new Response('{}');};
 assert.equal((await relayRuntime(post('{}',{origin:'https://other.example'}),'hosted',send)).status,403);
 assert.equal((await relayRuntime(new Request('https://standalone.example/api/archindus/hosted'),'hosted',send)).status,405);
 assert.equal((await relayRuntime(post('x'.repeat(150001)),'hosted',send)).status,413);assert.equal(calls,0);
});
test('preserves streaming and cooldowns without forwarding visitor credentials or cookies',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"text":"Orion"}\n\n'));c.close();}});
 const response=await relayRuntime(post('{"objective":"hello"}',{authorization:'Bearer private',cookie:'session=private'}),'hosted',async(url,options)=>{
  assert.equal(url,SHARED_RUNTIME_ORIGIN+'/api/archindus/hosted');assert.equal(new TextDecoder().decode(options.body),'{"objective":"hello"}');
  assert.equal(options.headers.Origin,SHARED_RUNTIME_ORIGIN);assert.equal(options.headers.authorization,undefined);assert.equal(options.headers.cookie,undefined);assert.equal(options.redirect,'error');
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Retry-After':'60','Set-Cookie':'upstream=private'}});
 });
 assert.match(await response.text(),/Orion/);assert.equal(response.headers.get('retry-after'),'60');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('keeps upstream capacity failures and reports connection failures honestly',async()=>{
 const response=await relayRuntime(post(),'hosted',async()=>new Response('{"code":"hosted_limit"}',{status:429,headers:{'content-type':'application/json'}}));
 assert.equal(response.status,429);assert.deepEqual(await response.json(),{code:'hosted_limit'});
 const fail=async()=>{throw Error('network unavailable');};assert.equal((await relayRuntime(post(),'hosted',fail)).status,503);
 const status=await relayRuntime(new Request('https://standalone.example/api/archindus/status'),'status',fail);assert.equal((await status.json()).hosted.available,false);
});
