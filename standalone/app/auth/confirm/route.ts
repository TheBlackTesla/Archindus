import {env} from 'cloudflare:workers';
import {withEmailAuth,confirmEmail} from '../../../lib/email-auth';
export const GET=(request:Request)=>withEmailAuth(request,env as unknown as Record<string,unknown>,client=>confirmEmail(request,client));
