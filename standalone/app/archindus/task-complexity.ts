export type TaskComplexity={level:'routine'|'standard'|'demanding';minimumLevel:number;reasons:string[]};
type Turn={role:string;content:string};
export function classifyTask(objective:string,task:string,history:Turn[]=[]):TaskComplexity{
 // Inspect the instruction, not quoted code or attached reference documents.
 const instruction=objective.split(/\n\n(?:Attached|Attachment|File excerpts|Reference files|Verified browser)/i)[0]
  .replace(/```[\s\S]*?```/g,' ').replace(/"[^"\n]*"|'[^'\n]*'/g,' ');
 const followup=/^\s*(?:continue|yes|do it|go ahead|now (?:add|change|implement)|revise (?:it|that)|expand (?:it|that))\b/i.test(instruction);
 const boundedRevision=/\b(?:summari[sz]e|shorten|rephrase|reword|translate|format|bullet points|one sentence|two sentences|make (?:it|that) (?:shorter|concise)|more concise)\b/i.test(instruction);
 const previous=followup&&!boundedRevision?[...history].reverse().find(m=>m.role==='user')?.content.slice(0,4000)??'':'';
 const text=(previous+'\n'+instruction).toLowerCase();
 const reasons:string[]=[];
 const explicit=/\b(?:deep research|rigorous proof|prove\b[^.\n]{0,100}\btheorem|highest quality|most capable|best model|use astra|complex (?:reasoning|architecture))\b/.test(text)
  && !/\b(?:no|without|do not|don't)\b[^.\n]{0,35}\b(?:deep research|rigorous proof|highest quality|best model|complex reasoning|complex architecture)\b/.test(text);
 if(explicit&&!/^\s*(?:what is|what does|define|explain the (?:term|phrase))\b/i.test(instruction))reasons.push('Explicit request for advanced reasoning or maximum quality');
 const engineering=/\b(?:distributed|multi[- ]tenant|concurrent|concurrency|race condition|deadlock|transaction|idempotenc\w*|fault[- ]toleran\w*|consensus|cryptograph\w*)\b/.test(text);
 const implementation=/\b(?:implement|design|debug|repair|refactor|build|migrate|audit|verify|architect)\b/.test(text);
 const constraints=(text.match(/\b(?:must|ensure|preserve|without|rollback|atomic|recover\w*|backward[- ]compatib\w*|security|isolation|latency|budget|invariant\w*)\b/g)??[]).length;
 if(engineering&&implementation&&constraints>=2)reasons.push('Engineering implementation with interacting correctness constraints');
 const reasoning=/\b(?:prove|derive|optimi[sz]e|reconcile|evaluate|compare|analy[sz]e)\b/.test(text);
 const dependencies=/\b(?:multiple sources|conflicting|contradict\w*|sensitivity analysis|trade[- ]offs|counterexample|formal verification|multi[- ]step|multi[- ]stage)\b/.test(text);
 if(reasoning&&dependencies&&constraints>=1)reasons.push('Analysis requiring reconciliation or several dependent reasoning steps');
 const contextLength=history.reduce((size,m)=>size+m.content.length,0)+objective.length;
 if(contextLength>18000&&implementation&&constraints>=2)reasons.push('Large working context with constrained implementation');
 if(reasons.length)return {level:'demanding',minimumLevel:4,reasons};
 if(['code','analysis','document'].includes(task)||implementation||dependencies)return {level:'standard',minimumLevel:task==='code'?3:2,reasons:['Task needs structured work but has no demanding combination of constraints']};
 return {level:'routine',minimumLevel:1,reasons:['Everyday conversation or a bounded single-step request']};
}
