import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const site=process.argv[2];if(!site||new URL(site).protocol!=='https:')throw Error('Pass the HTTPS site origin.');
process.stdout.write('Ready for trial JSON on stdin (input is hidden).\n');
const input=await new Promise((resolve,reject)=>{let text='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();const onData=chunk=>{text+=chunk.toString();if(text.includes('\u0003'))process.exit(130);if(text.length>2000)reject(Error('Invalid credential input'));if(text.includes('\n')){process.stdin.off('data',onData);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(text.trim()))}catch{reject(Error('Invalid input'))}}};process.stdin.on('data',onData)});
if(!/^[a-f0-9]{64}$/.test(input.token??''))throw Error('Invalid trial credential.');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(body){for(let retry=0;retry<4;retry++){
 const response=await fetch(new URL('/api/archindus/evaluate',site),{method:'POST',headers:{Origin:new URL(site).origin,'Content-Type':'application/json',Authorization:'Bearer '+input.token,'User-Agent':'Mozilla/5.0'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const data=await response.json();if(response.ok)return data;
 if(response.status===429){console.log('Waiting for shared quota controls.');await wait(Math.min(30000,Math.max(15000,Number(response.headers.get('Retry-After'))*1000||15000)));continue}
 throw Error(data.error??'Trial request failed');
}throw Error('Shared quota still unavailable; rerun to resume safely.');}
const run=await call({action:'start'});console.log(JSON.stringify({runId:run.runId,suite:run.suiteVersion,snapshot:run.snapshot}));
await mkdir('docs/evaluations',{recursive:true});let outputs={};try{const previous=JSON.parse(await readFile('docs/evaluations/controlled-trial.json','utf8'));if(previous.runId===run.runId)outputs=previous.outputs??{}}catch{}
const hash=value=>createHash('sha256').update(value).digest('hex');const cases=[...run.cases].sort((a,b)=>hash(run.runId+a.id).localeCompare(hash(run.runId+b.id)));
let lastCall=0;
for(const item of cases){const choices=run.snapshot[item.task],shared=choices.champion.provider===choices.challenger.provider&&choices.champion.model===choices.challenger.model;const first=parseInt(hash(run.runId+item.id).slice(0,2),16)%2?'champion':'challenger';const arms=shared?[first]:[first,first==='champion'?'challenger':'champion'];
 for(const arm of arms){await wait(Math.max(0,13000-(Date.now()-lastCall)));lastCall=Date.now();const result=await call({action:'case',runId:run.runId,caseId:item.id,arm});if(typeof result.output==='string')outputs[item.id+':'+result.observation.arm]=result.output;
 console.log(JSON.stringify({case:item.id,arm:result.observation.arm,status:result.observation.status,passed:result.observation.passed,reason:result.observation.reason,reused:result.reused}));
 const report=await call({action:'report',runId:run.runId});await writeFile('docs/evaluations/controlled-trial.json',JSON.stringify({...report,recordedAt:new Date().toISOString(),outputs},null,2)+'\n');
 }
}
const report=await call({action:'report',runId:run.runId});console.log(JSON.stringify(report.summary,null,2));
