import {withEmailAuth} from '../../../../lib/email-auth';
import {env} from 'cloudflare:workers';
import {handleMedia,comfyConfiguration} from '../../../../lib/inference/comfy';
import {environmentForRequest} from '../../../../lib/inference/user-environment';
import type {AccountDb} from '../../../../lib/account';
const handle=async(request:Request)=>withEmailAuth(request,env as unknown as Record<string,unknown>,async()=>{const e=await environmentForRequest(request),config=comfyConfiguration(e.values);return handleMedia(request,{db:e.db as AccountDb|undefined,config,ledgerSecret:e.routerSecret??e.key??e.providers?.find(p=>p.key)?.key??config?.key,limits:e.limits})});
export {handle as GET,handle as POST,handle as DELETE};
