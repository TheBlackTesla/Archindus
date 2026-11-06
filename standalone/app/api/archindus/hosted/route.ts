import {withEmailAuth} from '../../../../lib/email-auth';
import {env} from 'cloudflare:workers';
import {environmentForRequest} from "../../../../lib/inference/user-environment";
import { handleHosted } from "../../../../lib/inference/hosted";
import {accountIdentity,accountPersonalization,type AccountDb} from '../../../../lib/account';

async function handle(request: Request) {
  const environment=await environmentForRequest(request);
  return handleHosted(request,{...environment,personalize:(temporary,personalityId)=>accountPersonalization(environment.db as AccountDb|undefined,accountIdentity(request),temporary,personalityId)});
}

export const POST=(request:Request)=>withEmailAuth(request,env as unknown as Record<string,unknown>,()=>handle(request));
