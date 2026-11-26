import {InferenceClient} from '@huggingface/inference';
import {z} from 'zod';
import {boundedAccountJson} from '../account';
import {clientKey,reserve,settle,type UsageDb,type Limits} from './budget';
import {boundedProviderJson,type PublicModel} from './providers';
import {validateGeneratedImage} from '../../app/archindus/image-output';
const models={image:'black-forest-labs/FLUX.1-schnell',video:'Wan-AI/Wan2.2-TI2V-5B'} as const;
const json=(data:unknown,status:number)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function cloudMediaInventory(values:Record<string,unknown>):PublicModel[]{
 const configured=!!values.HF_TOKEN&&values.ARCHINDUS_HOSTED_ENABLED==='true';
 const free=typeof values.OPENROUTER_API_KEY==='string'&&Date.now()<Date.parse('2026-11-28T00:00:00Z');
 const pool:PublicModel[]=free?[{id:'openrouter-media/recraft-free',provider:'openrouter-media',providerName:'OpenRouter',name:'Recraft V4.1 Flash V2 Free',modelId:'recraft/recraft-v4.1-flash-v2:free',kind:'image',configured:true,state:'Free promotional endpoint · retires November 28, 2026',input:0,output:0}]:[];
 return [...pool,...(['image','video'] as const).map(kind=>({id:'huggingface-media/'+kind,provider:'huggingface-media',providerName:'Hugging Face / fal.ai',name:kind==='image'?'FLUX.1 Schnell':'Wan2.2 5B',modelId:models[kind],kind,configured,state:configured?'Configured · generation checked on request':'Hugging Face token required',openWeights:true}))];
}
type Deps={values:Record<string,unknown>;db?:UsageDb;limits:Limits;generate?:(kind:'image'|'video',prompt:string,signal:AbortSignal)=>Promise<Blob>};
export async function handleCloudMedia(request:Request,deps:Deps){
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Use the Archindus media form.'},403);
 const freeKey=deps.values.OPENROUTER_API_KEY;
 const useFreeImage=typeof freeKey==='string'&&!!freeKey&&Date.now()<Date.parse('2026-11-28T00:00:00Z');
 const key=deps.values.HF_TOKEN;
 if((!useFreeImage&&(typeof key!=='string'||!key))||deps.values.ARCHINDUS_HOSTED_ENABLED!=='true'||!deps.db)return json({error:'Hugging Face media is not configured.',code:'media_unconfigured'},503);
 let input;
 try{input=z.object({kind:z.enum(['image','video']),prompt:z.string().trim().min(1).max(2400)}).strict().parse(await boundedAccountJson(request,12000))}catch{return json({error:'Use a description under 2,400 characters.'},400)}
 const {kind,prompt}=input,id=crypto.randomUUID(),db=deps.db;
 const free=kind==='image'&&useFreeImage;
 if(!free&&(typeof key!=='string'||!key))return json({error:'Hugging Face video credentials are required.'},503);
 const ledgerKey=free?freeKey as string:key as string;
 let outputModel=models[kind]+' · Hugging Face / fal.ai';
 // Fixed 512px PNG / provider-standard short video. Conservative reservations
 // retain the full amount when provider usage cannot be established.
 const amount=free?0:kind==='image'?10000:250000;
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(kind==='video'?180000:90000)]);
 try{
  const client=await clientKey(request,ledgerKey,new Date().toISOString().slice(0,10));
  if(!await reserve(db,{id,client,kind,now:Date.now(),activeMs:210000,amount,limits:deps.limits,provider:free?'openrouter-media':'huggingface-media',zeroCost:free}))return json({error:'Media spending or capacity limit reached.'},429);
 }catch{return json({error:'Media usage controls are unavailable.'},503)}
 try{
  let blob:Blob;
  if(deps.generate)blob=await deps.generate(kind,prompt,signal);
  else if(free){
   const r=await fetch('https://openrouter.ai/api/v1/images',{method:'POST',headers:{Authorization:'Bearer '+freeKey,'Content-Type':'application/json'},body:JSON.stringify({model:'recraft/recraft-v4.1-flash-v2:free',prompt,n:1}),redirect:'manual',signal});
   if(!r.ok)return json({error:'OpenRouter free image request was rejected (HTTP '+r.status+').',code:'free_image_rejected'},503);
   const data=await boundedProviderJson(r,15000000),b64=data.data?.[0]?.b64_json;
   if(typeof b64!=='string'||b64.length>14000000)return json({error:'OpenRouter returned no usable image data.',code:'free_image_data'},502);
   const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
   blob=new Blob([bytes],{type:jpeg?'image/jpeg':'image/png'});
   outputModel='recraft/recraft-v4.1-flash-v2:free · OpenRouter';
  }else{
   const client=new InferenceClient(key as string);
   blob=kind==='image'
    ?await client.textToImage({model:models.image,provider:'fal-ai',inputs:prompt,parameters:{width:512,height:512,num_inference_steps:4},extra_body:{output_format:'png',num_images:1}},{signal})
    :await client.textToVideo({model:models.video,provider:'fal-ai',inputs:prompt},{signal});
  }
  if(blob.size>20000000)throw Error('Media too large');
  if(kind==='image'&&blob.type==='image/png'){
   const header=await blob.slice(0,24).arrayBuffer();
   const width=header.byteLength>=24?new DataView(header).getUint32(16):0;
   if(width<256||width>1536)throw Error('Invalid image size');
   await validateGeneratedImage(blob,width);
  }
  else if(kind==='video'){const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());if(blob.type!=='video/mp4'||String.fromCharCode(...bytes.slice(4,8))!=='ftyp')throw Error('Invalid video');}
  return new Response(blob,{headers:{'Content-Type':blob.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Archindus-Model':outputModel}});
 }catch(error){
  if(request.signal.aborted)return json({error:'Generation stopped. The provider may finish work already submitted.'},499);
  const status=Number((error as {httpResponse?:{status?:number}})?.httpResponse?.status);
  if([401,402,403].includes(status))return json({error:'Hugging Face media requires inference permission, model access and available credits.'},503);
  return json({error:free?'The free image provider returned an invalid or incomplete image. Please retry.':'The media provider could not complete this generation. Check Hugging Face credits and model access.'},503);
 }finally{await settle(db,id).catch(()=>{})}
}
