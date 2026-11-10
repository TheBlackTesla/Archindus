import {modelLabel} from './model-label';
import {z} from 'zod';
import {accountIdentity,boundedAccountJson,accountPersonalization,type AccountDb} from '../account';
import {clientKey,reserve,settle,type Limits} from './budget';
import {safeRuntimeURL,boundedProviderJson,type PublicModel} from './providers';
import {validateGeneratedImage} from '../../app/archindus/image-output';
const workflowSchema=z.array(z.object({id:z.string().regex(/^[a-z0-9-]{1,60}$/),name:z.string().min(1).max(100),kind:z.enum(['image','video']),model:z.string().min(1).max(180),width:z.number().int().min(256).max(1536).default(1024),license:z.string().max(100).optional(),workflow:z.record(z.string(),z.object({class_type:z.string().min(1).max(100),inputs:z.record(z.string(),z.unknown())}).passthrough())}).strict()).max(12);
export type MediaWorkflow=z.infer<typeof workflowSchema>[number];
export type ComfyConfig={url:string;key:string;workflows:MediaWorkflow[]};
export function comfyConfiguration(values:Record<string,unknown>){const str=(k:string)=>typeof values[k]==='string'?(values[k] as string).trim():'';try{if(!str('COMFYUI_BASE_URL')||!str('COMFYUI_API_KEY')||!str('ARCHINDUS_MEDIA_WORKFLOWS'))return undefined;const workflows=workflowSchema.parse(JSON.parse(str('ARCHINDUS_MEDIA_WORKFLOWS')));if(!workflows.length)return undefined;for(const w of workflows){if(Object.keys(w.workflow).length>200||!JSON.stringify(w.workflow).includes('__ARCHINDUS_PROMPT__'))throw Error('Workflow needs a prompt input')}return {url:safeRuntimeURL(str('COMFYUI_BASE_URL'),str('ARCHINDUS_ALLOW_LOCAL_ENDPOINTS')==='true'),key:str('COMFYUI_API_KEY'),workflows}}catch{return undefined}}
export function mediaInventory(config?:ComfyConfig):PublicModel[]{return (config?.workflows??[]).map(w=>({id:'comfyui/'+w.id,provider:'comfyui',providerName:'ComfyUI',name:w.name,modelId:w.model,kind:w.kind,configured:true,state:'Configured workflow · worker availability checked on request',openWeights:true,license:w.license??'Check model card'}))}
export const OPEN_MEDIA_CATALOG:PublicModel[]=[
 {id:'comfyui/flux2-klein-4b',provider:'comfyui',providerName:'ComfyUI',name:'FLUX.2 Klein 4B',modelId:'black-forest-labs/FLUX.2-klein-4B',kind:'image',configured:false,state:'GPU worker and exported workflow required',openWeights:true,license:'Apache-2.0'},
 {id:'comfyui/sdxl',provider:'comfyui',providerName:'ComfyUI',name:'Stable Diffusion XL',modelId:'stabilityai/stable-diffusion-xl-base-1.0',kind:'image',configured:false,state:'GPU worker and exported workflow required',openWeights:true,license:'CreativeML Open RAIL++-M'},
 {id:'comfyui/qwen-image',provider:'comfyui',providerName:'ComfyUI',name:'Qwen Image',modelId:'Qwen/Qwen-Image',kind:'image',configured:false,state:'GPU worker and exported workflow required',openWeights:true,license:'Check model card'},
 {id:'comfyui/wan22-5b',provider:'comfyui',providerName:'ComfyUI',name:'Wan2.2 TI2V 5B',modelId:'Wan-AI/Wan2.2-TI2V-5B',kind:'video',configured:false,state:'GPU worker and exported workflow required',openWeights:true,architecture:'MoE family; 5B hybrid variant',license:'Apache-2.0'},
 {id:'comfyui/ltx2',provider:'comfyui',providerName:'ComfyUI',name:'LTX-2',modelId:'Lightricks/LTX-2',kind:'video',configured:false,state:'GPU worker and exported workflow required',openWeights:true,license:'Check model card'},
 {id:'comfyui/hunyuan-video',provider:'comfyui',providerName:'ComfyUI',name:'HunyuanVideo',modelId:'tencent/HunyuanVideo',kind:'video',configured:false,state:'GPU worker and exported workflow required',openWeights:true,license:'Tencent model-specific license'},
];
type Job={id:string;remote_id:string;kind:'image'|'video';model:string;width:number;status:string;reservation_id:string;expires_at:number;artifact_json:string};
type Deps={db?:AccountDb;config?:ComfyConfig;ledgerSecret?:string;limits:Limits;fetch?:typeof fetch;now?:()=>number};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie'}});
export function fillWorkflow(workflow:MediaWorkflow['workflow'],prompt:string,seed:number){const replace=(value:unknown):unknown=>value==='__ARCHINDUS_PROMPT__'?prompt:value==='__ARCHINDUS_SEED__'?seed:Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)])):value;return replace(workflow)}
function artifactFrom(history:any,kind:'image'|'video'){for(const output of Object.values(history?.outputs??{}) as any[])for(const value of [...(output.images??[]),...(output.gifs??[]),...(output.videos??[])]){if(typeof value.filename!=='string'||!/^[A-Za-z0-9_. -]{1,180}$/.test(value.filename)||value.filename.includes('..')||!value.filename.toLowerCase().endsWith(kind==='image'?'.png':'.mp4'))continue;const folder=typeof value.subfolder==='string'?value.subfolder:'';if(folder.includes('..')||!/^[-A-Za-z0-9_/]*$/.test(folder)||value.type&&value.type!=='output')continue;return {filename:value.filename,subfolder:folder,type:'output'}}return undefined}
export async function handleMedia(request:Request,deps:Deps){
 const user=accountIdentity(request);if(!user)return json({error:'Sign in to generate media on a connected GPU worker.'},401);
 if(request.method!=='GET'&&(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json')))return json({error:'Send media requests from Archindus.'},403);
 if(!deps.db)return json({error:'Media job storage is unavailable.'},503);const db=deps.db,config=deps.config;
 const segments=new URL(request.url).pathname.split('/').filter(Boolean).slice(3),id=segments[0];if(id&&!z.string().uuid().safeParse(id).success)return json({error:'Invalid media job.'},400);
 const now=deps.now?.()??Date.now(),send=deps.fetch??fetch.bind(globalThis);
 try{
 if(request.method==='POST'&&!id){
  if(!config||!deps.ledgerSecret)return json({error:'No GPU media workflow is connected yet.',code:'media_unconfigured'},503);
  const profile=await db.prepare('SELECT data_version FROM account_profiles WHERE user_id=?').bind(user.id).first<{data_version:string}>();if(!profile||request.headers.get('x-archindus-account-version')!==profile.data_version)return json({error:'Refresh your account before creating media.'},409);
  const input=z.object({kind:z.enum(['image','video']),prompt:z.string().trim().min(1).max(2400),personalityId:z.string().uuid().optional(),temporary:z.boolean().optional()}).strict().parse(await boundedAccountJson(request,16000));
  const personal=await accountPersonalization(db,user,true,input.personalityId) as {personalityContext?:string},workflow=config.workflows.find(w=>w.kind===input.kind);if(!workflow)return json({error:'No '+input.kind+' workflow is connected.',code:'media_unconfigured'},503);
  const prompt=input.prompt+(personal.personalityContext?'\nCreative direction: '+personal.personalityContext+' Do not render instructions as text.':''),jobId=crypto.randomUUID();
  const client=await clientKey(request,deps.ledgerSecret,new Date(now).toISOString().slice(0,10));if(!await reserve(db,{id:jobId,client,kind:input.kind,amount:0,zeroCost:true,provider:'comfyui',activeMs:900000,now,limits:deps.limits}))return json({error:'Media generation capacity or rate limit reached.'},429);
  let remoteId:string|undefined;
  try{const response=await send(config.url+'/prompt',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)]),body:JSON.stringify({prompt:fillWorkflow(workflow.workflow,prompt,crypto.getRandomValues(new Uint32Array(1))[0]),client_id:jobId})});const result=await boundedProviderJson(response,32000);if(!response.ok||!z.string().uuid().safeParse(result.prompt_id).success)throw Error('GPU worker did not accept the workflow');remoteId=result.prompt_id;
   await db.prepare('INSERT INTO media_jobs(id,user_id,remote_id,kind,model,width,status,reservation_id,created_at,expires_at,artifact_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(jobId,user.id,remoteId,input.kind,modelLabel({id:workflow.model,name:workflow.name},'ComfyUI'),workflow.width,'queued',jobId,now,now+86400000,'').run();return json({id:jobId,status:'queued',model:modelLabel({id:workflow.model,name:workflow.name},'ComfyUI'),kind:input.kind},202);
  }catch{if(remoteId)await send(config.url+'/queue',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({delete:[remoteId]}),redirect:'error',signal:AbortSignal.timeout(3000)}).catch(()=>{});await settle(db,jobId,0);return json({error:'The GPU worker could not accept this job. Check its models and workflow.'},503)}
 }
 if(!id)return json({error:'Media job not found.'},404);
 const job=await db.prepare('SELECT * FROM media_jobs WHERE user_id=? AND id=?').bind(user.id,id).first<Job>();if(!job)return json({error:'Media job not found.'},404);
 if(job.expires_at<now)return json({error:'This media download expired. Generate it again.'},410);
 if(!config)return json({error:'The GPU worker is disconnected.'},503);
 const headers={Authorization:'Bearer '+config.key};
 if(request.method==='DELETE'){
  await boundedAccountJson(request,1000);await send(config.url+'/queue',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({delete:[job.remote_id]}),signal:AbortSignal.timeout(5000),redirect:'error'}).catch(()=>{});
  await db.prepare("UPDATE media_jobs SET status='canceled' WHERE user_id=? AND id=?").bind(user.id,id).run();await settle(db,job.reservation_id,0);return json({canceled:true,note:'Queued jobs are removed. A job already running on the worker may finish there.'});
 }
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 if(job.status==='canceled'||job.status==='error')return json({id,status:job.status,model:job.model,kind:job.kind});
 if(segments[1]==='file'){
  if(job.status!=='complete'||!job.artifact_json)return json({error:'Media is not ready.'},409);const artifact=JSON.parse(job.artifact_json),url=new URL(config.url+'/view');for(const [k,v] of Object.entries(artifact))url.searchParams.set(k,String(v));
  const response=await send(url,{headers,redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)])});if(!response.ok)return json({error:'The generated file is unavailable on the worker.'},502);
  const reader=response.body?.getReader();if(!reader)throw Error('No media');const chunks:Uint8Array[]=[];let length=0;try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>20000000){await reader.cancel();throw Error('Media too large')}chunks.push(part.value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}const blob=new Blob([bytes],{type:job.kind==='image'?'image/png':'video/mp4'});if(job.kind==='image')await validateGeneratedImage(blob,job.width);else if(length<16||String.fromCharCode(...bytes.slice(4,8))!=='ftyp')throw Error('Invalid MP4');
  return new Response(blob,{headers:{'Content-Type':blob.type,'Cache-Control':'no-store','Content-Disposition':`inline; filename="archindus-${job.kind}.${job.kind==='image'?'png':'mp4'}"`,'X-Content-Type-Options':'nosniff','Vary':'Cookie'}});
 }
 if(job.status==='complete')return json({id,status:'complete',model:job.model,kind:job.kind});
 const response=await send(config.url+'/history/'+job.remote_id,{headers,redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});if(!response.ok)return json({error:'The GPU worker could not report progress.'},503);const data=await boundedProviderJson(response,1000000),entry=data[job.remote_id];
 if(entry?.status?.status_str==='error'){await db.prepare("UPDATE media_jobs SET status='error' WHERE user_id=? AND id=?").bind(user.id,id).run();await settle(db,job.reservation_id,0);return json({id,status:'error',error:'The workflow failed on the GPU worker. Check its model files and nodes.'})}
 const artifact=artifactFrom(entry,job.kind);if(artifact){await db.prepare("UPDATE media_jobs SET status='complete',artifact_json=? WHERE user_id=? AND id=?").bind(JSON.stringify(artifact),user.id,id).run();await settle(db,job.reservation_id,0);return json({id,status:'complete',model:job.model,kind:job.kind})}
 if(entry?.status?.completed){await db.prepare("UPDATE media_jobs SET status='error' WHERE user_id=? AND id=?").bind(user.id,id).run();await settle(db,job.reservation_id,0);return json({id,status:'error',error:'The workflow finished without a supported PNG or MP4 output.'})}
 return json({id,status:'queued',model:job.model,kind:job.kind});
 }catch(e){if(e instanceof Error&&e.name==='PersonalityNotFound')return json({error:'This personality is unavailable.'},404);return json({error:e instanceof z.ZodError?'Invalid media request.':'Media could not be processed. Please retry.'},e instanceof z.ZodError?400:502)}
}
