import {cloudMediaInventory} from '../../../../lib/inference/cloud-media';
import {withEmailAuth} from '../../../../lib/email-auth';
import {env} from 'cloudflare:workers';
import {environmentForRequest} from '../../../../lib/inference/user-environment';
import {MODEL_CATALOG} from '../../../../lib/inference/models';
import {providerConfiguration,discoverLocalModels} from '../../../../lib/inference/providers';
import {comfyConfiguration,mediaInventory,OPEN_MEDIA_CATALOG} from '../../../../lib/inference/comfy';
async function handle(request:Request){const {values}=await environmentForRequest(request);const config=providerConfiguration(values),media=mediaInventory(comfyConfiguration(values));
 const groq=config.providers.find(p=>p.id==='groq');
 if(groq){const available=await discoverLocalModels(groq,fetch,request.signal);for(const item of config.inventory.filter(m=>m.provider==='groq'))item.state=available.some(m=>m.id===item.modelId)?item.state+' · listed by Groq':'Configured · not listed or discovery unavailable';}
 return Response.json({models:[...cloudMediaInventory(values),...MODEL_CATALOG.map(m=>({id:'openai/'+m.id,provider:'openai',providerName:'OpenAI',name:m.name,modelId:m.id,kind:'chat',configured:!!values.OPENAI_API_KEY&&values.ARCHINDUS_HOSTED_ENABLED==='true',state:values.OPENAI_API_KEY?'Credential configured · availability checked on request':'Setup required',input:m.input,output:m.output})),...config.inventory,...media,...OPEN_MEDIA_CATALOG.filter(m=>!media.some(w=>w.modelId===m.modelId))],issues:config.issues,notes:'Configured does not mean live-verified. Self-hosted API fees exclude hardware, power and hosting costs.'},{headers:{'Cache-Control':'no-store'}})}

export const GET=(request:Request)=>withEmailAuth(request,env as unknown as Record<string,unknown>,()=>handle(request));
