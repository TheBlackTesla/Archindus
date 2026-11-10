import {z} from 'zod';
import {accountIdentity,boundedAccountJson} from '../account';
import {clientKey,type UsageDb} from './budget';
import {ARCHINDUS_VOICE_ID,ARCHINDUS_VOICE_MODEL,VOICE_TEXT_LIMIT,VOICE_DAY_CHARACTERS,VOICE_MONTH_CHARACTERS,VOICE_AUDIO_LIMIT} from '../../app/archindus/voice-config';
export type VoiceDependencies={key?:string;db?:UsageDb;fetch?:typeof fetch;now?:()=>number};
const reply=(error:string,status:number)=>Response.json({error},{status,headers:{'Cache-Control':'no-store','Vary':'Cookie'}});
export function voiceStatus(deps:VoiceDependencies){return Response.json({configured:!!(deps.key&&deps.db),provider:'ElevenLabs',voiceId:ARCHINDUS_VOICE_ID,model:ARCHINDUS_VOICE_MODEL,requiresSignIn:true},{headers:{'Cache-Control':'no-store'}})}
export async function handleVoice(request:Request,deps:VoiceDependencies){
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply('Send voice requests from Archindus.',403);
 const user=accountIdentity(request);if(!user)return reply('Sign in to use the Archindus ElevenLabs voice.',401);
 if(!deps.key||!deps.db)return reply('The Archindus voice is selected, but its ElevenLabs API key has not been connected.',503);
 let input;try{input=z.object({text:z.string().trim().min(1).max(VOICE_TEXT_LIMIT)}).strict().parse(await boundedAccountJson(request,16000))}catch{return reply('Use between 1 and 2,400 characters for a voice response.',400)}
 const id=crypto.randomUUID(),now=deps.now?.()??Date.now(),date=new Date(now).toISOString(),day=date.slice(0,10),month=date.slice(0,7),characters=Array.from(input.text).length;
 try{
  request.signal.throwIfAborted();
  const client=await clientKey(request,deps.key,day);
  const row=await deps.db.prepare(`INSERT INTO voice_usage(id,user_id,day,month,characters,created_at,active_until)
   SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT SUM(characters) FROM voice_usage WHERE day=?),0)+?<=?
   AND COALESCE((SELECT SUM(characters) FROM voice_usage WHERE month=?),0)+?<=?
   AND (SELECT COUNT(*) FROM voice_usage WHERE user_id=? AND day=?)<20
   AND (SELECT COUNT(*) FROM voice_usage WHERE user_id=? AND created_at>?)<3
   AND (SELECT COUNT(*) FROM voice_usage WHERE active_until>?)<2 RETURNING id`).bind(id,client,day,month,characters,now,now+35000,day,characters,VOICE_DAY_CHARACTERS,month,characters,VOICE_MONTH_CHARACTERS,client,day,client,now-60000,now).first();
  if(!row)return reply('Voice usage limit reached. Your text response is still available.',429);
 }catch{return reply('Voice usage controls are unavailable. Your text response is still available.',503)}
 try{
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(25000)]);
  const response=await (deps.fetch??fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${ARCHINDUS_VOICE_ID}?output_format=mp3_44100_128`,{method:'POST',headers:{'xi-api-key':deps.key,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text:input.text,model_id:ARCHINDUS_VOICE_MODEL}),signal});
  if(!response.ok)return reply(response.status===401||response.status===403?'The ElevenLabs key cannot access this voice. Check its voice and text-to-speech permissions.':response.status===429?'ElevenLabs is at its usage or rate limit. Try Listen again later.':'ElevenLabs could not generate this voice. Your text response is still available.',502);
  if(!response.headers.get('content-type')?.toLowerCase().includes('audio/'))return reply('The voice service did not return audio.',502);
  const reader=response.body?.getReader();if(!reader)return reply('The voice service returned no audio.',502);
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>VOICE_AUDIO_LIMIT){await reader.cancel();throw Error('Audio too large')}chunks.push(part.value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  if(bytes.length<4||!((bytes[0]===73&&bytes[1]===68&&bytes[2]===51)||(bytes[0]===255&&(bytes[1]&224)===224)))return reply('The voice service returned invalid audio.',502);
  return new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(size),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'}});
 }catch{return reply(request.signal.aborted?'Voice stopped.':'Voice could not be generated. Your text response is still available.',502)}
 finally{await deps.db.prepare('UPDATE voice_usage SET active_until=0 WHERE id=?').bind(id).run().catch(()=>{});}
}
