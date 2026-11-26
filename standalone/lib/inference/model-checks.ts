import type {AccountDb} from '../account';
import {boundedAccountJson} from '../account';
import {handleHosted,type HostedDependencies,IMAGE_MODEL} from './hosted';
import {gradeQuality,QUALITY_CASES} from './quality-benchmark';

const targets:Record<string,{agent:string;fixture:string}>={'gpt-6.2-sol':{agent:'satoshi',fixture:'add-function'},'gpt-6.2-astra':{agent:'socrates',fixture:'books'},[IMAGE_MODEL]:{agent:'ounumi',fixture:'image'}};
type CheckRow={target:string;day:string;checked_at:number;outcome:string;actual_model:string|null};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function modelChecks(request:Request,db:AccountDb|undefined,deps:HostedDependencies,authorizedDay:unknown){
 if(!db)return json({error:'Verification storage is unavailable.'},503);
 const now=(deps.now??Date.now)(),day=new Date(now).toISOString().slice(0,10);
 if(request.method==='GET'){
   const rows=(await db.prepare('SELECT target,day,checked_at,outcome,actual_model FROM model_checks ORDER BY checked_at DESC LIMIT 120').all<CheckRow>()).results;
   return json({armed:authorizedDay===day,checks:Object.entries(targets).map(([model,info])=>{
     const last=rows.find(r=>r.target===model),pass=rows.find(r=>(r.outcome==='passed'||r.outcome==='fallback_passed')&&r.actual_model===model);
     return {model,agent:info.agent,outcome:last?.outcome??'unverified',actual:last?.actual_model,checkedAt:last?.checked_at,lastPassedAt:pass?.checked_at,ranToday:!!last&&last.day===day};
   }),fallback:rows.find(r=>r.outcome==='fallback_passed')??null});
 }
 if(request.method!=='POST'||authorizedDay!==day)return json({error:'The operator has not enabled a check for today.'},403);
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Use the Archindus verification form.'},403);
 let target:string;try{target=(await boundedAccountJson(request,300)).target;if(!Object.hasOwn(targets,target))throw Error()}catch{return json({error:'Unknown check.'},400)}
 const claimed=await db.prepare("INSERT INTO model_checks(target,day,checked_at,outcome) VALUES(?,?,?,'started') ON CONFLICT(target,day) DO NOTHING RETURNING target").bind(target,day,now).first();
 if(!claimed)return json({outcome:'already_checked'});
 const {agent,fixture}=targets[target];
 const image=fixture==='image',item=image?undefined:QUALITY_CASES.find(c=>c.id===fixture)!;
 let outcome='unavailable',actual:string|null=null;
 try{
   const body={action:image?'image':'generate',requestId:crypto.randomUUID(),selectedAgentId:agent,temporary:true,history:[],plan:{primaryId:agent,task:image?'image':item!.task},objective:image?'A single red circle on a plain white background.':item!.prompt+(agent==='satoshi'?' Wrap the JSON in one fenced json code block.':'')};
   const req=new Request(request.url,{method:'POST',headers:{origin:new URL(request.url).origin,'content-type':'application/json'},body:JSON.stringify(body),signal:request.signal});
   const response=await handleHosted(req,{...deps,providers:[],personalize:undefined,personalContext:undefined,modelPolicy:agent==='socrates'?'quality':'auto'});
   if(response.ok&&image){
     actual=response.headers.get('X-Archindus-Model');const bytes=await response.arrayBuffer();
     if(actual&&bytes.byteLength>0&&response.headers.get('content-type')==='image/png')outcome=actual===target?'passed':'fallback_passed';
   }else if(response.ok){
     const result=await response.json();const id=result.reportedModel;
     // A dated alias is accepted only when it identifies the same model.
     if(id===target||(typeof id==='string'&&id.startsWith(target+'-')&&/^\d{4}-\d{2}-\d{2}$/.test(id.slice(target.length+1))))actual=target;
     outcome=actual&&gradeQuality(item!,result.text).passed?'passed':'output_failed';
   }else {const error=await response.json().catch(()=>({}));outcome=error.code==='hosted_limit'?'budget_or_capacity':error.code==='hosted_cooldown'?'cooldown':'unavailable';}
 }catch{outcome='unavailable'}
 await db.prepare('UPDATE model_checks SET actual_model=?,outcome=?,checked_at=? WHERE target=? AND day=?').bind(actual,outcome,(deps.now??Date.now)(),target,day).run();
 return json({target,actual,outcome});
}
