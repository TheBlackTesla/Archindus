import {ACTIVE_ROUTING_POLICY,SHADOW_ROUTING_POLICY} from './learning-policy';
import {recordModelOutcome} from './metrics';
import {modelCooldownSeconds,recordFailure,pauseModel,freeProviderCooldownSeconds,recordFreeProviderLimit} from './health';
import type {RoutingAttempt} from '../../app/archindus/routing-receipt';
import {classifyTask,type TaskComplexity} from '../../app/archindus/task-complexity';
import {adaptiveOrder} from './adaptive';
import type {AccountDb} from '../account';
import {modelLabel} from './model-label';
import type {TaskPlan} from '../../app/archindus/orchestration';
import {parsePlan} from '../../app/archindus/orchestration';
import {formatAnswer,validateAnswer} from '../../app/archindus/answer';
import {clientKey,providerCooldownSeconds,reserve,settle,type Limits,type UsageDb} from './budget';
import {textCost,textUsageCost,type TextModel,type ModelPolicy} from './models';
import {discoverLocalModels,rankCandidates,boundedProviderJson,type Provider,type RouteModel} from './providers';
import {providerCompletion} from './provider-transport';
import {streamedCompletion} from './stream';
export type MultiContext={request:Request;id:string;plan:TaskPlan;objective:string;messages:{role:string;content:string}[];stream:boolean;planning:boolean;policy?:ModelPolicy;providers:Provider[];openAIKey?:string;routerSecret?:string;openAIModel:TextModel;db:UsageDb;limits:Limits;send:typeof fetch;now:()=>number;temporary?:boolean;complexity?:TaskComplexity};
const reply=(error:string,status:number,code='provider_unavailable')=>Response.json({error,code},{status,headers:{'Cache-Control':'no-store'}});
export async function routedCompletion(c:MultiContext){
 const secret=c.routerSecret??c.openAIKey??c.providers.find(p=>p.key)?.key;if(!secret)return reply('A router credential is required for usage accounting.',503);
 const candidates:{provider:Provider;model:RouteModel}[]=[];
 for(const p of c.providers){if(await providerCooldownSeconds(c.db,c.now(),p.id))continue;for(const m of await discoverLocalModels(p,c.send,c.request.signal))candidates.push({provider:p,model:m})}
 if(c.openAIKey&&!await providerCooldownSeconds(c.db,c.now(),'openai'))candidates.push({provider:{id:'openai',name:'OpenAI',url:'https://api.openai.com/v1',key:c.openAIKey,protocol:'openai',selfHosted:false,models:[]},model:{...c.openAIModel,level:c.openAIModel.reasoning==='high'?4:c.plan.task==='code'?3:['analysis','document'].includes(c.plan.task)?2:1,capabilities:['chat','code','analysis']}});
 const complexity=c.complexity??classifyTask(c.objective,c.plan.task,c.messages.filter(m=>m.role!=='system').slice(0,-1));
 const deep=complexity.level==='demanding';
 // Preserve cost order across providers and allow another model from the same
 // provider to recover a model-specific failure. No provider gets a reserved slot.
 const healthy=[];for(const candidate of candidates)if(!await modelCooldownSeconds(c.db,candidate.provider.id,candidate.model.id,c.now())&&!(candidate.model.input===0&&candidate.model.output===0&&await freeProviderCooldownSeconds(c.db,candidate.provider.id,c.now())))healthy.push(candidate);
 const available=await adaptiveOrder(rankCandidates(healthy,c.plan.task,c.policy,deep),c.request,c.db as AccountDb,c.plan.task,!!c.temporary,c.send,c.now());

 if(!available.length)return reply('No configured model currently meets this task and privacy policy. Check provider connections.',503);
 const client=await clientKey(c.request,secret,new Date(c.now()).toISOString().slice(0,10));let last='Configured providers could not complete this request.';
 const attempts:RoutingAttempt[]=[];
 const receipt=()=>({policyVersion:ACTIVE_ROUTING_POLICY,shadowPolicyVersion:SHADOW_ROUTING_POLICY,attempts:attempts.map(a=>({...a}))});
 for(let i=0;i<available.length;i++){
  c.request.signal.throwIfAborted();if(attempts.length>=6)break;const {provider,model}=available[i],id=attempts.length?crypto.randomUUID():c.id;
  if(await modelCooldownSeconds(c.db,provider.id,model.id,c.now())||await providerCooldownSeconds(c.db,c.now(),provider.id)||model.input===0&&model.output===0&&await freeProviderCooldownSeconds(c.db,provider.id,c.now()))continue;
  const baseLimit=c.planning?240:model.reasoning==='high'?8000:['code','document'].includes(c.plan.task)?6000:1800;
  const limit=provider.id==='groq'?Math.min(baseLimit,model.reasoning==='high'?4096:['code','document'].includes(c.plan.task)?3072:1200):baseLimit;
  const inputBytes=c.messages.reduce((s,m)=>s+new TextEncoder().encode(m.content).length+32,256),amount=textCost(inputBytes,limit,model);let streamOwns=false,actual:number|undefined;
  let allowed=false;try{allowed=await reserve(c.db,{id,client,kind:'text',amount,now:c.now(),limits:c.limits,provider:provider.id,zeroCost:provider.selfHosted||['openrouter','groq'].includes(provider.id)&&amount===0});}catch{return reply('Router usage controls are unavailable.',503)}
  if(!allowed){last='Hosted capacity or spending limit reached.';continue}
  const started=c.now();const attempt:RoutingAttempt={model:modelLabel(model,provider.name),outcome:'unavailable',elapsedMs:0,reservedMicrodollars:amount};attempts.push(attempt);
  const upstream=new AbortController(),signal=AbortSignal.any([c.request.signal,upstream.signal,AbortSignal.timeout(model.reasoning==='high'?110000:60000)]);
  try{
   const response=await providerCompletion(provider,model,c.messages,limit,c.stream,signal,c.send);
   if(!response.ok){const error=await boundedProviderJson(response,32000).catch(()=>null),code=error?.error?.code??error?.error?.type;
    if(/content_policy|moderation|safety|refusal/i.test(String(code??'')+' '+String(error?.error?.message??''))){attempt.outcome='refused';return reply('Please revise your request.',422,'content_refused');}
    if([400,401,402,403,404,422].includes(response.status))actual=0;
    await recordFreeProviderLimit(c.db,provider.id,model.id,response,c.now());
    attempt.outcome=await recordFailure(c.db,provider.id,model.id,response.status,response.headers.get('Retry-After'),c.now(),response.headers);last=provider.name+' is unavailable; another configured engine will be tried.';continue;
   }
   let name=modelLabel(model,provider.name);
   if(c.stream&&response.headers.get('content-type')?.includes('text/event-stream')){streamOwns=true;return streamedCompletion(response,{signal,cancel:()=>upstream.abort(),task:c.plan.task,model:name,identity:{model,provider:provider.name},rates:model,receipt:()=>receipt(),onOutcome:async(outcome,charged,label)=>{if(label)attempt.model=label;attempt.outcome=outcome;attempt.elapsedMs=Math.max(0,c.now()-started);attempt.chargedMicrodollars=charged;if(outcome!=='refused')await recordModelOutcome(c.db,provider.id,model.id,c.plan.task,outcome==='complete',attempt.elapsedMs,charged,c.now()).catch(()=>{});if(outcome==='invalid_output')await pauseModel(c.db,provider.id,model.id,c.now())},settle:actual=>settle(c.db,id,actual)})}
   const data=await boundedProviderJson(response),usage=data.usage;if(Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0&&Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0)actual=textUsageCost(usage,model);
   name=modelLabel(model,provider.name,data.model);attempt.model=name;
   const choice=data.choices?.[0];if(choice?.message?.refusal||choice?.finish_reason==='content_filter'){attempt.outcome='refused';return reply('Please revise your request.',422,'content_refused');}
   if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'){attempt.outcome='invalid_output';await pauseModel(c.db,provider.id,model.id,c.now());last='A model returned an incomplete answer.';continue}
   if(c.planning){attempt.outcome='complete';return Response.json({plan:parsePlan(choice.message.content,c.plan),model:name},{headers:{'Cache-Control':'no-store'}});}
   const text=formatAnswer(choice.message.content,c.plan.task);if(validateAnswer(text,c.plan.task)){attempt.outcome='invalid_output';await pauseModel(c.db,provider.id,model.id,c.now());last='A model returned an incomplete answer.';continue}
   attempt.outcome='complete';attempt.elapsedMs=Math.max(0,c.now()-started);attempt.chargedMicrodollars=actual;
   return Response.json({text,model:name,receipt:receipt()},{headers:{'Cache-Control':'no-store'}});
  }catch{c.request.signal.throwIfAborted();last=provider.name+' could not complete the request.';await pauseModel(c.db,provider.id,model.id,c.now()).catch(()=>{})}
  finally{if(!streamOwns){attempt.elapsedMs=Math.max(0,c.now()-started);attempt.chargedMicrodollars=actual;if(attempt.outcome!=='refused')await recordModelOutcome(c.db,provider.id,model.id,c.plan.task,attempt.outcome==='complete',attempt.elapsedMs,actual,c.now()).catch(()=>{});}if(!streamOwns)await settle(c.db,id,actual).catch(()=>{})}
 }
 return Response.json({error:last,code:'provider_unavailable',receipt:receipt()},{status:last.includes('spending limit')?429:503,headers:{'Cache-Control':'no-store'}});
}
