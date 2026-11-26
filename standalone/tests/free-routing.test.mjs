import test from 'node:test';
import {classifyTask} from '../app/archindus/task-complexity.ts';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url).pathname;
await build({stdin:{contents:"export {rankCandidates} from './lib/inference/providers'",resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',outfile:root+'outputs/free-routing.mjs',logLevel:'silent'});
const {rankCandidates}=await import('../outputs/free-routing.mjs');
const candidate=(provider,level,input,output)=>({provider:{id:provider},model:{id:provider,level,input,output,capabilities:['chat','code','analysis']}});
const free=candidate('openrouter',1,0,0),hf=candidate('huggingface',3,.2,.6),openai=candidate('openai',3,2,10),frontier=candidate('openai',4,10,50);
test('ordinary chat, code and analysis try the free pool before eligible paid models',()=>{
 for(const task of ['chat','code','analysis','document']){
  assert.deepEqual(rankCandidates([openai,hf,free],task).map(c=>c.provider.id),['openrouter','huggingface','openai']);
 }
});
test('deep reasoning and explicit quality preserve capability requirements',()=>{
 assert.deepEqual(rankCandidates([free,hf,frontier],'analysis','auto',true),[frontier]);
 assert.deepEqual(rankCandidates([free,hf,frontier],'chat','quality'),[frontier]);
});
test('free routes still need the requested capability',()=>{
 assert.deepEqual(rankCandidates([{...free,model:{...free.model,capabilities:['chat']}}],'code'),[]);
});

test('a demanding engineering task admits paid reasoning and excludes insufficient free models',()=>{
 const objective='Design a distributed migration. Preserve isolation and ensure rollback without downtime.';
 const complex=classifyTask(objective,'code');
 assert.equal(complex.level,'demanding');
 assert.deepEqual(rankCandidates([free,hf,frontier],'code','auto',complex.level==='demanding'),[frontier]);
 const capableFree=candidate('openrouter',4,0,0);
 assert.deepEqual(rankCandidates([frontier,capableFree],'code','auto',true),[capableFree,frontier]);
 assert.deepEqual(rankCandidates([free,frontier],'code','economy',true),[frontier]);
});
