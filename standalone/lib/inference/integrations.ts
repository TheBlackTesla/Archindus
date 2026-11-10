import {z} from 'zod';
import {boundedAccountJson,type AccountDb} from '../account';
import {PROVIDER_DEFINITIONS,providerConfiguration,safeRuntimeURL} from './providers';
import {comfyConfiguration} from './comfy';
const ids=['deepseek','xai','anthropic','ollama','local','openrouter','huggingface','groq','together','comfyui'] as const;
const schema=z.object({provider:z.enum(ids),apiKey:z.string().trim().min(1).max(2000),baseURL:z.string().trim().max(500).optional(),models:z.string().trim().max(2000).optional(),workflows:z.string().max(65000).optional()}).strict();
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function wrappingKey(value:string){const bytes=decode(value);if(bytes.length!==32)throw Error('Invalid credential storage key');return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function encryptConnection(values:Record<string,string>,secret:string,userId:string,provider:string,version:string){const iv=crypto.getRandomValues(new Uint8Array(12)),additionalData=new TextEncoder().encode(userId+'|'+provider+'|'+version);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},await wrappingKey(secret),new TextEncoder().encode(JSON.stringify(values)));return encode(iv)+'.'+encode(new Uint8Array(encrypted))}
export async function decryptConnection(cipher:string,secret:string,userId:string,provider:string,version:string){const [iv,data]=cipher.split('.');const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:new TextEncoder().encode(userId+'|'+provider+'|'+version)},await wrappingKey(secret),decode(data));return JSON.parse(new TextDecoder().decode(bytes)) as Record<string,string>}
function connectionValues(input:z.infer<typeof schema>){const values:Record<string,string>={};const local=['ollama','local','comfyui'].includes(input.provider);
 if(local){if(!input.baseURL)throw Error('Enter a public HTTPS runtime gateway URL.');const url=safeRuntimeURL(input.baseURL);const host=new URL(url).hostname;if(!['.trycloudflare.com','.ts.net','.onrender.com','.hf.space'].some(suffix=>host.endsWith(suffix)))throw Error('Use an authenticated Cloudflare Tunnel, Tailscale Funnel, Render or Hugging Face runtime gateway.');values[input.provider==='ollama'?'OLLAMA_BASE_URL':input.provider==='local'?'LOCAL_RUNTIME_BASE_URL':'COMFYUI_BASE_URL']=url;}
 if(input.provider==='comfyui'){values.COMFYUI_API_KEY=input.apiKey;values.ARCHINDUS_MEDIA_WORKFLOWS=input.workflows??'';if(!comfyConfiguration(values))throw Error('Add a valid exported image/video workflow configuration.');return values}
 const definition=PROVIDER_DEFINITIONS.find(p=>p.id===input.provider)!;values[definition.key]=input.apiKey;
 if(input.provider==='ollama'&&input.models)values.OLLAMA_MODELS=input.models;
 if(input.provider==='local'){
  // Self-hosted models need no API billing estimate; the operator selects profiles.
  const models=(input.models??'').split(',').map(s=>s.trim()).filter(Boolean);if(!models.length)throw Error('List the model IDs exposed by your local runtime.');
  values.ARCHINDUS_PROVIDER_MODELS=JSON.stringify({local:models.map(id=>({id,name:id,input:0,output:0,level:3,capabilities:['chat','code','analysis'],openWeights:true,license:'Operator-selected model'}))});
 }
 const configuration=providerConfiguration(values);if(configuration.issues.length)throw Error('Check the endpoint and model configuration.');
 return values;
}
export async function handleIntegrations(request:Request,db:AccountDb,userId:string,version:string,path:string[],secret?:string){
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie'}});
 if(request.method==='GET'&&path.length===1){const rows=await db.prepare('SELECT provider,label,endpoint_hint AS endpointHint,updated_at AS updatedAt FROM account_integrations WHERE user_id=? AND data_version=? ORDER BY provider').bind(userId,version).all();return json({connections:rows.results,secureStorageReady:!!secret})}
 if(request.method==='DELETE'&&path.length===2){const provider=z.enum(ids).parse(path[1]);await db.prepare('DELETE FROM account_integrations WHERE user_id=? AND provider=? AND data_version=?').bind(userId,provider,version).run();return json({deleted:true})}
 if(request.method==='POST'&&path.length===1){if(!secret)return json({error:'Secure provider connection storage is not available yet.'},503);
  try{const input=schema.parse(await boundedAccountJson(request,80000)),values=connectionValues(input),cipher=await encryptConnection(values,secret,userId,input.provider,version),label=input.provider==='comfyui'?'ComfyUI':PROVIDER_DEFINITIONS.find(p=>p.id===input.provider)!.name;
   const row=await db.prepare(`INSERT INTO account_integrations(user_id,provider,data_version,label,endpoint_hint,encrypted_value,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM account_profiles WHERE user_id=? AND data_version=?) ON CONFLICT(user_id,provider) DO UPDATE SET data_version=excluded.data_version,label=excluded.label,endpoint_hint=excluded.endpoint_hint,encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at RETURNING provider`).bind(userId,input.provider,version,label,input.baseURL?new URL(input.baseURL).origin:'',cipher,Date.now(),userId,version).first();return row?json({saved:true,provider:input.provider}):json({error:'Your account changed. Refresh before connecting.'},409);
  }catch(e){return json({error:e instanceof z.ZodError?'Check the provider connection fields.':e instanceof Error?e.message:'Connection could not be saved.'},400)}
 }return json({error:'Not found.'},404);
}
export async function userConnectionValues(db:AccountDb|undefined,userId:string|undefined,secret:string|undefined){if(!db||!userId||!secret)return {};
 const profile=await db.prepare('SELECT data_version FROM account_profiles WHERE user_id=?').bind(userId).first<{data_version:string}>();if(!profile)return {};
 const rows=await db.prepare('SELECT provider,encrypted_value FROM account_integrations WHERE user_id=? AND data_version=?').bind(userId,profile.data_version).all<{provider:string;encrypted_value:string}>();let values:Record<string,string>={};
 for(const row of rows.results){try{const decoded=await decryptConnection(row.encrypted_value,secret,userId,row.provider,profile.data_version);if(decoded.ARCHINDUS_PROVIDER_MODELS){const merged={...JSON.parse(values.ARCHINDUS_PROVIDER_MODELS??'{}'),...JSON.parse(decoded.ARCHINDUS_PROVIDER_MODELS)};decoded.ARCHINDUS_PROVIDER_MODELS=JSON.stringify(merged)}values={...values,...decoded}}catch{/* A rotated storage key requires reconnection, never plaintext fallback. */}}
 return values;
}
