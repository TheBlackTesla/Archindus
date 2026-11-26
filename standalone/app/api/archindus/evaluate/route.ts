import {env} from 'cloudflare:workers';
import {hostedEnvironment} from '../../../../lib/inference/environment';
import {handleQualityTrial} from '../../../../lib/inference/quality-trial';
import type {AccountDb} from '../../../../lib/account';
export const POST=(request:Request)=>{const values=env as unknown as Record<string,unknown>,environment=hostedEnvironment();return handleQualityTrial(request,{db:environment.db as AccountDb|undefined,providers:environment.providers,limits:environment.limits,tokenHash:typeof values.ARCHINDUS_EVAL_TOKEN_SHA256==='string'?values.ARCHINDUS_EVAL_TOKEN_SHA256:undefined,expiresAt:typeof values.ARCHINDUS_EVAL_EXPIRES_AT==='string'?values.ARCHINDUS_EVAL_EXPIRES_AT:undefined})};
