import {modelLabel} from './model-label';
import type {TaskPlan} from '../../app/archindus/orchestration';
import {parsePlan} from '../../app/archindus/orchestration';
import {formatAnswer,validateAnswer} from '../../app/archindus/answer';
import {clientKey,pauseProvider,providerCooldownSeconds,reserve,settle,type Limits,type UsageDb} from './budget';
import {textCost,textUsageCost,type TextModel,type ModelPolicy} from './models';
import {discoverLocalModels,rankCandidates,boundedProviderJson,type Provider,type RouteModel} from './providers';
import {providerCompletion} from './provider-transport';
import {streamedCompletion} from './stream';
export type MultiContext={request:Request;id:string;plan:TaskPlan;objective:string;messages:{role:string;content:string}[];stream:boolean;planning:boolean;policy?:ModelPolicy;providers:Provider[];openAIKey?:string;routerSecret?:string;openAIModel:TextModel;db:UsageDb;limits:Limits;send:typeof fetch;now:()=>number};
const reply=(error:string,status:number,code='provider_unavailable')=>Response.json({error,code},{status,headers:{'Cache-Control':'no-store'}});
export async function routedCompletion(c:MultiContext){
 const secret=c.routerSecret??c.openAIKey??c.providers.find(p=>p.key)?.key;if(!secret)return reply('A router credential is required for usage accounting.',503);
 const candidates:{provider:Provider;model:RouteModel}[]=[];
 for(const p of c.providers){if(await providerCooldownSeconds(c.db,c.now(),p.id))continue;for(const m of await discoverLocalModels(p,c.send,c.request.signal))candidates.push({provider:p,model:m})}
 if(c.openAIKey&&!await providerCooldownSeconds(c.db,c.now(),'openai'))candidates.push({provider:{id:'openai',name:'OpenAI',url:'https://api.openai.com/v1',key:c.openAIKey,protocol:'openai',selfHosted:false,models:[]},model:{...c.openAIModel,level:c.openAIModel.reasoning==='high'?4:c.plan.task==='code'?3:['analysis','document'].includes(c.plan.task)?2:1,capabilities:['chat','code','analysis']}});
 const deep=/\b(deep research|rigorous proof|prove.*theorem|complex (?:reasoning|architecture))\b/i.test(c.objective);
 const ordered=rankCandidates(candidates,c.plan.task,c.policy,deep),seen=new Set<string>();const ranked=ordered.filter(item=>{if(seen.has(item.provider.id))return false;seen.add(item.provider.id);return true}).slice(0,3);const openAI=ordered.find(item=>item.provider.id==='openai');if(openAI&&!ranked.some(item=>item.provider.id==='openai'))ranked.push(openAI);
 if(!ranked.length)return reply('No configured model currently meets this task and privacy policy. Check provider connections.',503);
 const client=await clientKey(c.request,secret,new Date(c.now()).toISOString().slice(0,10));let last='Configured providers could not complete this request.';
 for(let i=0;i<ranked.length;i++){
  c.request.signal.throwIfAborted();const {provider,model}=ranked[i],id=i?crypto.randomUUID():c.id;
  const limit=c.planning?240:model.reasoning==='high'?8000:['code','document'].includes(c.plan.task)?6000:1800;
  const inputBytes=c.messages.reduce((s,m)=>s+new TextEncoder().encode(m.content).length+32,256),amount=textCost(inputBytes,limit,model);let streamOwns=false,actual:number|undefined;
  let allowed=false;try{allowed=await reserve(c.db,{id,client,kind:'text',amount,now:c.now(),limits:c.limits,provider:provider.id,zeroCost:provider.selfHosted||provider.id==='openrouter'&&amount===0});}catch{return reply('Router usage controls are unavailable.',503)}
  if(!allowed){last='Hosted capacity or spending limit reached.';continue}
  const upstream=new AbortController(),signal=AbortSignal.any([c.request.signal,upstream.signal,AbortSignal.timeout(model.reasoning==='high'?110000:60000)]);
  try{
   const response=await providerCompletion(provider,model,c.messages,limit,c.stream,signal,c.send);
   if(!response.ok){const error=await boundedProviderJson(response,32000).catch(()=>null),code=error?.error?.code??error?.error?.type;
    if(/content_policy|moderation|safety|refusal/i.test(String(code??'')+' '+String(error?.error?.message??'')))return reply('Please revise your request.',422,'content_refused');
    if([400,401,402,403,404,422].includes(response.status))actual=0;
    await pauseProvider(c.db,[401,402,403].includes(response.status)?300:60,c.now(),provider.id);last=provider.name+' is unavailable; another configured engine will be tried.';continue;
   }
   let name=modelLabel(model,provider.name);
   if(c.stream&&response.headers.get('content-type')?.includes('text/event-stream')){streamOwns=true;return streamedCompletion(response,{signal,cancel:()=>upstream.abort(),task:c.plan.task,model:name,identity:{model,provider:provider.name},rates:model,settle:actual=>settle(c.db,id,actual)})}
   const data=await boundedProviderJson(response),usage=data.usage;if(Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0&&Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0)actual=textUsageCost(usage,model);
   name=modelLabel(model,provider.name,data.model);
   const choice=data.choices?.[0];if(choice?.message?.refusal||choice?.finish_reason==='content_filter')return reply('Please revise your request.',422,'content_refused');
   if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'){last='A model returned an incomplete answer.';continue}
   if(c.planning)return Response.json({plan:parsePlan(choice.message.content,c.plan),model:name},{headers:{'Cache-Control':'no-store'}});
   const text=formatAnswer(choice.message.content,c.plan.task);if(validateAnswer(text,c.plan.task)){last='A model returned an incomplete answer.';continue}
   return Response.json({text,model:name},{headers:{'Cache-Control':'no-store'}});
  }catch{c.request.signal.throwIfAborted();last=provider.name+' could not complete the request.';await pauseProvider(c.db,60,c.now(),provider.id).catch(()=>{})}
  finally{if(!streamOwns)await settle(c.db,id,actual).catch(()=>{})}
 }
 return reply(last,last.includes('spending limit')?429:503);
}
