import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
register('./helpers/cloudflare-loader.mjs',import.meta.url);
test('serves the complete standalone Oracle workspace at root and its existing alias',async()=>{
 const {default:worker}=await import('../dist/server/index.js');
 for(const route of ['/','/archindus']){
  const response=await worker.fetch(new Request('http://localhost'+route,{headers:{accept:'text/html'}}),{ASSETS:{fetch:async()=>new Response('Not found',{status:404})}},{waitUntil(){},passThroughOnException(){}});
  assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/What do you want to accomplish/);assert.match(html,/archindus-prompt/);assert.match(html,/oracle-brand/);
  assert.match(html,/https:\/\/archindus\.stevenscadet\.chatgpt\.site\//);assert.doesNotMatch(html,/codex-preview|Explore our work|contact-form/);
 }
});
