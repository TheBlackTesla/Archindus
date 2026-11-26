import {withEmailAuth} from '../../../../lib/email-auth';
import {env} from 'cloudflare:workers';
import {environmentForRequest} from '../../../../lib/inference/user-environment';
import {handleCloudMedia} from '../../../../lib/inference/cloud-media';
export const POST=(request:Request)=>withEmailAuth(request,env as unknown as Record<string,unknown>,async()=>{
 const e=await environmentForRequest(request);
 return handleCloudMedia(request,{values:e.values,db:e.db,limits:e.limits});
});
