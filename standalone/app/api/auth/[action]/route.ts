import {env} from 'cloudflare:workers';
import {withEmailAuth,handleEmailAuth} from '../../../../lib/email-auth';
const handle=(request:Request)=>withEmailAuth(request,env as unknown as Record<string,unknown>,client=>handleEmailAuth(request,env as unknown as Record<string,unknown>,client));
export {handle as GET,handle as POST};
