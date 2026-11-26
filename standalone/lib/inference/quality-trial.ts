import {z} from 'zod';
import {boundedAccountJson,type AccountDb} from '../account';
import {clientKey,reserve,settle,providerCooldownSeconds,type Limits} from './budget';
import {discoverLocalModels,rankCandidates,boundedProviderJson,type Provider} from './providers';
import {modelCooldownSeconds,freeProviderCooldownSeconds} from './health';
import {adaptiveRankings} from './adaptive';
import {providerCompletion} from './provider-transport';
import {modelLabel} from './model-label';
import {finalAnswer} from '../../app/archindus/answer';
import {ACTIVE_ROUTING_POLICY,SHADOW_ROUTING_POLICY,type ScoredRoute} from './learning-policy';
import {SUITE_VERSION,GRADER_VERSION,QUALITY_CASES,gradeQuality,summarizeQuality,type QualityObservation} from './quality-benchmark';
type Choice={provider:string;model:string};type Snapshot=Record<string,{champion:Choice;challenger:Choice;evidence:ScoredRoute[]}>;
type Run={id:string;day:string;suite:string;snapshot:string;created_at:number};
export type QualityTrialDeps={db?:AccountDb;providers:Provider[];limits:Limits;tokenHash?:string;expiresAt?:string;send?:typeof fetch;now?:()=>number};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('')}
async function authorized(request:Request,deps:QualityTrialDeps,now:number){
 const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
 if(!deps.tokenHash||!/^[a-f0-9]{64}$/.test(deps.tokenHash)||!Number.isFinite(Number(deps.expiresAt))||now>=Number(deps.expiresAt)||!/^[a-f0-9]{64}$/.test(supplied))return false;
 const hash=await digest(supplied);let difference=0;for(let i=0;i<64;i++)difference|=hash.charCodeAt(i)^deps.tokenHash.charCodeAt(i);return difference===0;
}
const requestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('start')}).strict(),
 z.object({action:z.literal('report'),runId:z.string().uuid()}).strict(),
 z.object({action:z.literal('case'),runId:z.string().uuid(),caseId:z.string().max(50).refine(id=>QUALITY_CASES.some(c=>c.id===id)),arm:z.enum(['champion','challenger'])}).strict(),
]);
export async function handleQualityTrial(request:Request,deps:QualityTrialDeps){
 const now=(deps.now??Date.now)(),send=deps.send??fetch;
 if(!await authorized(request,deps,now))return json({error:'Evaluation access unavailable.'},401);
 if(request.method!=='POST'||request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Invalid evaluation request.'},403);
 if(!deps.db)return json({error:'Evaluation storage unavailable.'},503);const db=deps.db;
 try{
 const input=requestSchema.parse(await boundedAccountJson(request,4000));
 if(input.action==='start'){
  const cutoff=now-30*86400000;
  await db.prepare('DELETE FROM routing_quality_results WHERE run_id IN (SELECT id FROM routing_quality_trials WHERE created_at < ?)').bind(cutoff).run();
  await db.prepare('DELETE FROM routing_quality_trials WHERE created_at < ?').bind(cutoff).run();
  const day=new Date(now).toISOString().slice(0,10);let run=await db.prepare('SELECT * FROM routing_quality_trials WHERE day=?').bind(day).first<Run>();
  if(!run){
   const candidates=[];
   for(const p of deps.providers.filter(p=>['groq','openrouter'].includes(p.id))){
    if(await providerCooldownSeconds(db,now,p.id)||await freeProviderCooldownSeconds(db,p.id,now))continue;
    for(const m of await discoverLocalModels(p,send,request.signal))if(m.input===0&&m.output===0&&!await modelCooldownSeconds(db,p.id,m.id,now))candidates.push({provider:p,model:m});
   }
   const snapshot:Snapshot={};
   for(const task of [...new Set(QUALITY_CASES.map(c=>c.task))]){
    const ordered=await adaptiveRankings(rankCandidates(candidates,task),request,db,task,true,send,now,false);
    if(!ordered.champion[0]||!ordered.challenger[0])return json({error:'No eligible free model for every benchmark task.'},409);
    const choice=(v:typeof ordered.champion[0])=>({provider:v.provider.id,model:v.model.id});snapshot[task]={champion:choice(ordered.champion[0]),challenger:choice(ordered.challenger[0]),evidence:ordered.evidence};
   }
   await db.prepare('INSERT INTO routing_quality_trials(id,day,suite,snapshot,created_at) VALUES(?,?,?,?,?) ON CONFLICT(day) DO NOTHING').bind(crypto.randomUUID(),day,SUITE_VERSION,JSON.stringify(snapshot),now).run();
   run=await db.prepare('SELECT * FROM routing_quality_trials WHERE day=?').bind(day).first<Run>();
  }
  if(!run||run.suite!==SUITE_VERSION)return json({error:'Existing trial uses a different suite.'},409);
  return json({runId:run.id,suiteVersion:SUITE_VERSION,graderVersion:GRADER_VERSION,champion:ACTIVE_ROUTING_POLICY,challenger:SHADOW_ROUTING_POLICY,snapshot:JSON.parse(run.snapshot),cases:QUALITY_CASES.map(({id,split,task})=>({id,split,task})),maximumCalls:24});
 }
 const run=await db.prepare('SELECT * FROM routing_quality_trials WHERE id=?').bind(input.runId).first<Run>();
 if(!run||run.suite!==SUITE_VERSION)return json({error:'Trial not found.'},404);
 if(input.action==='report'){
  const rows=await db.prepare("SELECT result FROM routing_quality_results WHERE run_id=? AND status!='pending' ORDER BY case_id,arm").bind(run.id).all<{result:string}>();const observations=rows.results.map(r=>JSON.parse(r.result) as QualityObservation);
  return json({runId:run.id,suiteVersion:SUITE_VERSION,graderVersion:GRADER_VERSION,champion:ACTIVE_ROUTING_POLICY,challenger:SHADOW_ROUTING_POLICY,snapshot:JSON.parse(run.snapshot),observations,summary:summarizeQuality(observations)});
 }
 if(run.day!==new Date(now).toISOString().slice(0,10))return json({error:'Trial execution window expired.'},409);
 const item=QUALITY_CASES.find(c=>c.id===input.caseId)!,choices=(JSON.parse(run.snapshot) as Snapshot)[item.task],chosen=choices[input.arm];
 const shared=choices.champion.provider===choices.challenger.provider&&choices.champion.model===choices.challenger.model;
 const arm=shared?'shared':input.arm,id=run.id+':'+item.id+':'+arm;
 const existing=await db.prepare('SELECT status,result FROM routing_quality_results WHERE id=?').bind(id).first<{status:string;result:string}>();
 if(existing)return existing.status==='pending'?json({error:'Case already running.'},409):json({observation:JSON.parse(existing.result),reused:true});
 const provider=deps.providers.find(p=>p.id===chosen.provider),model=provider?.models.find(m=>m.id===chosen.model&&m.input===0&&m.output===0);
 if(!provider||!model||!['groq','openrouter'].includes(provider.id))return json({error:'The selected model is no longer configured as free.'},409);
 const claim=await db.prepare("INSERT INTO routing_quality_results(id,run_id,case_id,arm,status,result,created_at) VALUES(?,?,?,?,'pending','',?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(id,run.id,item.id,arm,now).first();
 if(!claim)return json({error:'Case already claimed.'},409);
 const client=await clientKey(request,deps.tokenHash!,run.day);
 let reserved=false;try{reserved=await reserve(db,{id:'eval:'+id,client,kind:'text',provider:provider.id,amount:0,zeroCost:true,now,limits:deps.limits})}catch{}
 if(!reserved){await db.prepare("DELETE FROM routing_quality_results WHERE id=? AND status='pending'").bind(id).run();return new Response(JSON.stringify({error:'Shared usage controls denied this trial call.'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':'15','Cache-Control':'no-store'}})}
 const started=Date.now();let text='',observation:QualityObservation={caseId:item.id,arm,status:'unavailable',passed:false,reason:'generation_unavailable',model:modelLabel(model,provider.name),elapsedMs:0,chargedMicrodollars:0};
 try{
  const response=await providerCompletion(provider,model,[{role:'system',content:'You are Archindus. Complete this fixed public benchmark task. Return only the requested JSON, without commentary. No tools, external lookup, personal memories or user data are involved.'},{role:'user',content:item.prompt}],1024,false,AbortSignal.any([request.signal,AbortSignal.timeout(45000)]),send);
  if(response.ok){const data=await boundedProviderJson(response,100000),choice=data.choices?.[0];
   if(choice?.finish_reason==='stop'&&typeof choice.message?.content==='string'&&!choice.message?.refusal){text=finalAnswer(choice.message.content);const grade=gradeQuality(item,text);observation={...observation,...grade,status:'complete',model:modelLabel(model,provider.name,data.model),outputHash:await digest(text)};}
   else observation.reason='incomplete_or_refused';
  }else observation.reason=response.status===429?'rate_limited':'provider_unavailable';
 }catch{observation.reason='interrupted_or_unavailable'}
 finally{await settle(db,'eval:'+id,0).catch(()=>{})}
 observation.elapsedMs=Math.max(0,Date.now()-started);
 await db.prepare('UPDATE routing_quality_results SET status=?,result=? WHERE id=?').bind(observation.status,JSON.stringify(observation),id).run();
 return json({observation,output:text.slice(0,8000),reused:false});
 }catch(error){return json({error:error instanceof z.ZodError?'Invalid evaluation fields.':'Trial could not complete.'},error instanceof z.ZodError?400:503)}
}
