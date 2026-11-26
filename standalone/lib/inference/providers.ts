import {z} from 'zod';
import type {TextModel,ModelPolicy} from './models';
export type ProviderId='openai'|'deepseek'|'xai'|'anthropic'|'ollama'|'local'|'openrouter'|'huggingface'|'groq'|'together'|'gemini';
export type RouteModel=TextModel&{level:number;capabilities:('chat'|'code'|'analysis')[];openWeights?:boolean;architecture?:string;license?:string};
export type Provider={id:ProviderId;name:string;url:string;key?:string;protocol:'openai'|'anthropic';selfHosted:boolean;models:RouteModel[]};
export type PublicModel={id:string;provider:string;providerName:string;name:string;modelId:string;kind:'chat'|'image'|'video';configured:boolean;state:string;input?:number;output?:number;openWeights?:boolean;architecture?:string;license?:string};
const model=(id:string,name:string,input:number,output:number,level:number,extra:Partial<RouteModel>={}):RouteModel=>({id,name,input,output,cached:input,level,reasoning:level>=4?'high':'none',tier:level>=4?'Deep reasoning':level>=3?'Coding / analysis':level===2?'Balanced':'Economical',capabilities:['chat','code','analysis'],...extra});
export const OPEN_MODELS:RouteModel[]=[
 model('qwen3.5:4b','Qwen3.5 4B',0,0,1,{openWeights:true,license:'Apache-2.0'}),model('qwen3.5:9b','Qwen3.5 9B',0,0,2,{openWeights:true,license:'Apache-2.0'}),model('qwen3.5:27b','Qwen3.5 27B',0,0,3,{openWeights:true,license:'Apache-2.0'}),model('qwen3.5:35b','Qwen3.5 35B',0,0,3,{openWeights:true,architecture:'MoE',license:'Apache-2.0'}),
 model('qwen3.6:27b','Qwen3.6 27B',0,0,3,{openWeights:true,license:'Check model card'}),model('qwen3.6:35b','Qwen3.6 35B',0,0,3,{openWeights:true,architecture:'MoE',license:'Check model card'}),
 model('gpt-oss:20b','GPT-OSS 20B',0,0,3,{openWeights:true,architecture:'MoE',license:'Apache-2.0'}),model('gpt-oss:120b','GPT-OSS 120B',0,0,4,{openWeights:true,architecture:'MoE',license:'Apache-2.0'}),
 model('gemma4:e4b','Gemma 4 E4B',0,0,1,{openWeights:true,license:'Check model card'}),model('gemma4:26b','Gemma 4 26B',0,0,3,{openWeights:true,architecture:'MoE',license:'Check model card'}),model('gemma4:31b','Gemma 4 31B',0,0,3,{openWeights:true,license:'Check model card'}),
 model('qwen2.5-coder:7b','Qwen2.5 Coder 7B',0,0,2,{openWeights:true,license:'Apache-2.0'}),model('qwen2.5-coder:14b','Qwen2.5 Coder 14B',0,0,3,{openWeights:true,license:'Apache-2.0'}),model('deepseek-r1:14b','DeepSeek R1 Distill 14B',0,0,3,{openWeights:true,license:'Check model card'}),model('llama3.2:3b','Llama 3.2 3B',0,0,1,{openWeights:true,license:'Llama community license'}),model('mistral:7b','Mistral 7B',0,0,1,{openWeights:true,license:'Apache-2.0'})];
export const GROQ_MODELS:RouteModel[]=[
 model('openai/gpt-oss-20b','GPT-OSS 20B',.075,.30,2,{openWeights:true,architecture:'MoE',license:'Apache-2.0'}),
 model('openai/gpt-oss-120b','GPT-OSS 120B',.15,.60,4,{openWeights:true,architecture:'MoE',license:'Apache-2.0'}),
 model('qwen/qwen3.8-27b','Qwen 3.8 27B',.80,4,3,{openWeights:true,license:'Check model card (preview)'}),
];
export const PROVIDER_DEFINITIONS=[
 {id:'gemini',name:'Google Gemini',key:'GEMINI_API_KEY',url:'https://generativelanguage.googleapis.com/v1beta/openai',models:[model('gemini-3.1-flash-lite','Gemini 3.1 Flash-Lite',.5,3,2),model('gemini-3.8-flash','Gemini 3.8 Flash',1.5,7.5,4)]},
 {id:'deepseek',name:'DeepSeek',key:'DEEPSEEK_API_KEY',url:'https://api.deepseek.com',models:[model('deepseek-flash','DeepSeek Flash',.3,1.2,3,{openWeights:true,architecture:'MoE',license:'Check model card'}),model('deepseek-v4-pro','DeepSeek V4 Pro',1.32,3.96,4,{openWeights:true,architecture:'MoE',license:'Check model card'})]},
 {id:'xai',name:'xAI / Grok',key:'XAI_API_KEY',url:'https://api.x.ai/v1',models:[model('grok-4.7','Grok 4.7',2,6,4)]},
 {id:'anthropic',name:'Anthropic / Claude',key:'ANTHROPIC_API_KEY',url:'https://api.anthropic.com/v1',models:[model('claude-sonnet-5-5','Claude Sonnet 5.5',2,10,3),model('claude-opus-5-5','Claude Opus 5.5',4,20,4),model('claude-fable-5-1','Claude Fable 5.1',10,50,4)]},
 {id:'ollama',name:'Ollama',key:'OLLAMA_API_KEY',url:'',models:OPEN_MODELS},
 {id:'local',name:'vLLM / llama.cpp / LM Studio',key:'LOCAL_RUNTIME_API_KEY',url:'',models:[] as RouteModel[]},
 {id:'openrouter',name:'OpenRouter',key:'OPENROUTER_API_KEY',url:'https://openrouter.ai/api/v1',models:[model('openrouter/free','OpenRouter free tier',0,0,1,{license:'Provider/model-dependent'})]},
 {id:'huggingface',name:'Hugging Face',key:'HF_TOKEN',url:'https://router.huggingface.co/v1',models:[] as RouteModel[]},
 {id:'groq',name:'Groq',key:'GROQ_API_KEY',url:'https://api.groq.com/openai/v1',models:GROQ_MODELS},
 {id:'together',name:'Together AI',key:'TOGETHER_API_KEY',url:'https://api.together.xyz/v1',models:[] as RouteModel[]},
] as const;
const customSchema=z.array(z.object({id:z.string().min(1).max(180),name:z.string().min(1).max(100),input:z.number().finite().min(0).max(100),output:z.number().finite().min(0).max(500),level:z.number().int().min(1).max(4),capabilities:z.array(z.enum(['chat','code','analysis'])).min(1),openWeights:z.boolean().optional(),architecture:z.string().max(50).optional(),license:z.string().max(100).optional()}).strict()).max(40);
export function safeRuntimeURL(raw:string,allowLocal=false){const u=new URL(raw);if(u.username||u.password||u.search||u.hash)throw Error('Use an endpoint without embedded credentials, query, or fragment.');const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);if(u.protocol!=='https:'&&!(allowLocal&&local&&u.protocol==='http:'))throw Error('Runtime endpoints require HTTPS; local HTTP is development-only.');if(/(^|\.)(169\.254|metadata|0\.0\.0\.0)(\.|$)/.test(u.hostname))throw Error('Invalid runtime host.');return u.toString().replace(/\/$/,'')}
export function providerConfiguration(values:Record<string,unknown>){const value=(key:string)=>typeof values[key]==='string'?(values[key] as string).trim():'';let custom:Record<string,unknown>={};const issues:string[]=[];if(value('ARCHINDUS_PROVIDER_MODELS'))try{custom=JSON.parse(value('ARCHINDUS_PROVIDER_MODELS'));if(!custom||Array.isArray(custom)||typeof custom!=='object')throw Error()}catch{issues.push('ARCHINDUS_PROVIDER_MODELS is not a valid provider model map.');custom={}}
 const providers:Provider[]=[],inventory:PublicModel[]=[];
 for(const d of PROVIDER_DEFINITIONS){try{
  const local=d.id==='ollama'||d.id==='local',key=value(d.key)||(d.id==='huggingface'?value('HF_Token'):''),rawURL=d.id==='ollama'?value('OLLAMA_BASE_URL'):d.id==='local'?value('LOCAL_RUNTIME_BASE_URL'):d.url;
  let models:RouteModel[]=custom[d.id]!==undefined?customSchema.parse(custom[d.id]).map(m=>model(m.id,m.name,m.input,m.output,m.level,m)):d.models.map(m=>({...m}));
  if(d.id==='ollama'&&value('OLLAMA_MODELS')){const ids=value('OLLAMA_MODELS').split(',').map(s=>s.trim()).filter(Boolean).slice(0,40);models=ids.map(id=>models.find(m=>m.id===id)??model(id,id,0,0,1,{openWeights:true,license:'Check model card'}))}
  const freeGroq=d.id==='groq'&&value('ARCHINDUS_GROQ_FREE_TIER')==='true';
  if(freeGroq)models=models.map(m=>GROQ_MODELS.some(known=>known.id===m.id)?{...m,input:0,output:0,cached:0}:m);
  const allowedFree=(m:RouteModel)=>(d.id==='openrouter'&&(m.id==='openrouter/free'||m.id.endsWith(':free')))||(freeGroq&&GROQ_MODELS.some(known=>known.id===m.id));
  if(!local&&models.some(m=>m.input===0&&m.output===0&&!allowedFree(m)))throw Error('Hosted models require explicit nonzero price ceilings.');
  const configured=!!rawURL&&!!models.length&&(local?(!!key||value('ARCHINDUS_ALLOW_LOCAL_ENDPOINTS')==='true'):!!key);let url='';if(rawURL)url=safeRuntimeURL(rawURL,value('ARCHINDUS_ALLOW_LOCAL_ENDPOINTS')==='true');
  if(configured)providers.push({id:d.id,name:d.name,url,key:key||undefined,protocol:d.id==='anthropic'?'anthropic':'openai',selfHosted:local,models});
  for(const m of models)inventory.push({id:d.id+'/'+m.id,provider:d.id,providerName:d.name,name:m.name,modelId:m.id,kind:'chat',configured,state:configured?(local?'Configured · model discovery required':freeGroq?'Configured · declared Free Plan · quota limited':'Configured · availability checked on request'):'Setup required',input:m.input,output:m.output,openWeights:m.openWeights,architecture:m.architecture,license:m.license});
 }catch{issues.push(d.name+': invalid endpoint or model configuration.')}}
 return {providers,inventory,issues};
}
const groqDiscovery=new Map<string,{expires:number;ids:Set<string>}>();
export async function discoverLocalModels(provider:Provider,send:typeof fetch,signal:AbortSignal){
 if(provider.id==='groq'){
  const scope=provider.key??'',cached=groqDiscovery.get(scope);
  if(cached&&cached.expires>Date.now())return provider.models.filter(m=>cached.ids.has(m.id));
  try{
   const response=await send(provider.url+'/models',{headers:{Authorization:'Bearer '+scope},redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(3000)])});
   if(!response.ok)return [];
   const data=await boundedProviderJson(response,1000000);if(!Array.isArray(data.data))return [];
   const ids=new Set<string>(data.data.filter((m:{id?:unknown;active?:boolean})=>typeof m.id==='string'&&m.active!==false).slice(0,200).map((m:{id:string})=>m.id));
   if(groqDiscovery.size>=8)groqDiscovery.delete(groqDiscovery.keys().next().value!);
   groqDiscovery.set(scope,{ids,expires:Date.now()+300000});return provider.models.filter(m=>ids.has(m.id));
  }catch{signal.throwIfAborted();return []}
 }
 if(!provider.selfHosted)return provider.models;try{const r=await send(provider.url+'/models',{headers:provider.key?{Authorization:'Bearer '+provider.key}:{},redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});if(!r.ok)return [];const bytes=await boundedProviderJson(r,1_000_000);const ids=new Set((Array.isArray(bytes.data)?bytes.data:[]).slice(0,200).map((m:{id?:string})=>m.id));return provider.models.filter(m=>ids.has(m.id))}catch{signal.throwIfAborted();return []}}
export async function boundedProviderJson(response:Response,max=300000):Promise<any>{const reader=response.body?.getReader();if(!reader)throw Error('Missing provider body');let size=0,text='';const decoder=new TextDecoder();try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>max){await reader.cancel();throw Error('Provider body too large')}text+=decoder.decode(p.value,{stream:true})}return JSON.parse(text+decoder.decode())}finally{reader.releaseLock()}}
export function rankCandidates(candidates:{provider:Provider;model:RouteModel}[],task:string,policy:ModelPolicy='auto',deep=false){
 const demanding=policy==='quality'||deep;
 const min=demanding?4:policy==='economy'?1:task==='code'?3:['analysis','document'].includes(task)?2:1;
 const capability=task==='code'?'code':['analysis','document'].includes(task)?'analysis':'chat';
 const free=(item:{model:RouteModel})=>item.model.input===0&&item.model.output===0;
 return candidates.filter(item=>item.model.capabilities.includes(capability)
  && (item.model.level>=min||(!demanding&&free(item)&&item.provider.id==='openrouter')))
  .sort((a,b)=>{
   if(!demanding&&free(a)!==free(b))return free(a)?-1:1;
   if(policy==='quality'&&a.model.level!==b.model.level)return b.model.level-a.model.level;
   return (a.model.input+a.model.output*2)-(b.model.input+b.model.output*2)||a.model.level-b.model.level;
  });
}
