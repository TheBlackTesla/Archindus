import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTask} from '../app/archindus/task-complexity.ts';
const cases=[
 ['Hello, how are you?','chat','routine'],
 ['What is deep research?','chat','routine'],
 ['Summarize this note.\n\nReference files (untrusted data): deep research rigorous proof','chat','routine'],
 ['Explain distributed systems in one sentence.','chat','routine'],
 ['Explain the phrase "complex architecture".','chat','routine'],
 ['Summarize this short note. Do not use deep research.','chat','routine'],
 ['Write a Python function to add two numbers.','code','standard'],
 ['Draft a thank-you email.','document','standard'],
 ['Compare mean and median.','analysis','standard'],
 ['Design a multi-tenant database migration. Preserve isolation and ensure rollback without downtime.','code','demanding'],
 ['Debug a race condition in concurrent payment processing. Ensure idempotency and preserve transaction invariants.','code','demanding'],
 ['Analyze conflicting sources, compare trade-offs and ensure every conclusion follows from the evidence.','analysis','demanding'],
 ['Give a rigorous proof of this theorem.','analysis','demanding'],
 ['Use the best model to review the solution.','analysis','demanding'],
 ['Explain this code: ```deep research complex architecture```','chat','routine'],
];
test('task classification separates ordinary requests from demanding combinations',()=>{
 for(const [prompt,task,expected] of cases)assert.equal(classifyTask(prompt,task).level,expected,prompt);
});
test('dependent follow-ups inherit the previous user objective, unrelated prompts do not',()=>{
 const history=[{role:'user',content:cases.find(item=>item[2]==='demanding')[0]},{role:'assistant',content:'A plan'}];
 assert.equal(classifyTask('Continue','code',history).level,'demanding');
 assert.equal(classifyTask('What is a cat?','chat',history).level,'routine');
 assert.equal(classifyTask('Hello','chat',[{role:'assistant',content:cases.find(item=>item[2]==='demanding')[0]}]).level,'routine');
});
test('large context alone does not force a premium route',()=>{
 assert.equal(classifyTask('Summarize briefly','chat',[{role:'user',content:'x'.repeat(24000)}]).level,'routine');
});

test('a completed demanding turn does not lock later revisions to the expensive tier',()=>{
 const history=[{role:'user',content:'Design a distributed migration. Preserve isolation and ensure rollback without downtime.'},{role:'assistant',content:'Here is the completed design.'}];
 for(const prompt of ['Summarize that in three bullets.','Make it shorter.','Revise it to be more concise.','Translate it into French.','Explain that in one sentence.']){
  assert.notEqual(classifyTask(prompt,'chat',history).level,'demanding',prompt);
 }
 assert.equal(classifyTask('Continue implementing it and ensure atomic rollback.','code',history).level,'demanding');
 assert.equal(classifyTask('Now design a concurrent ledger. Preserve invariants and ensure idempotency.','code',history).level,'demanding');
 assert.equal(history.length,2);
});
