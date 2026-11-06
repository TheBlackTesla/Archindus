import {withEmailAuth} from '../../../../lib/email-auth';
import {env} from 'cloudflare:workers';
import {handleVoice,voiceStatus,type VoiceDependencies} from '../../../../lib/inference/voice';
const dependencies=():VoiceDependencies=>{const values=env as unknown as Record<string,unknown>;return {key:typeof values.ELEVENLABS_API_KEY==='string'?values.ELEVENLABS_API_KEY.trim():undefined,db:values.DB as VoiceDependencies['db']}};
export const GET=()=>voiceStatus(dependencies());
export const POST=(request:Request)=>withEmailAuth(request,env as unknown as Record<string,unknown>,()=>handleVoice(request,dependencies()));
