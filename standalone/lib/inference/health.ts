import {pauseProvider,providerCooldownSeconds,type UsageDb} from './budget';
/** No prompts, credentials or raw provider errors are stored in health state. */
export type FailureKind='authentication'|'credits'|'rate_limit'|'model_unavailable'|'invalid_request'|'service_unavailable'|'invalid_output';
export function failurePolicy(status:number,retryAfter:string|null,now:number){
 const parsed=retryAfter?(/^\d+(?:\.\d+)?$/.test(retryAfter)?Number(retryAfter):Math.ceil((Date.parse(retryAfter)-now)/1000)):NaN;
 const retry=Number.isFinite(parsed)?Math.max(1,Math.min(3600,Math.ceil(parsed))):60;
 if(status===401)return {kind:'authentication' as const,scope:'provider',seconds:300};
 if(status===402)return {kind:'credits' as const,scope:'provider',seconds:300};
 if(status===429)return {kind:'rate_limit' as const,scope:'model',seconds:retry};
 if([403,404].includes(status))return {kind:'model_unavailable' as const,scope:'model',seconds:300};
 if([400,422].includes(status))return {kind:'invalid_request' as const,scope:'model',seconds:30};
 return {kind:'service_unavailable' as const,scope:'model',seconds:60};
}
const key=(provider:string,model:string)=>`model:${provider}:${model}`;
export const modelCooldownSeconds=(db:UsageDb,provider:string,model:string,now:number)=>providerCooldownSeconds(db,now,key(provider,model));
export async function recordFailure(db:UsageDb,provider:string,model:string,status:number,retryAfter:string|null,now:number,headers?:Headers){
 const policy=failurePolicy(status,retryAfter,now);
 if(provider==='groq'&&status===429&&headers){
  for(const bucket of ['requests','tokens'])if(headers.get('x-ratelimit-remaining-'+bucket)==='0'){
   const duration=parseGroqDuration(headers.get('x-ratelimit-reset-'+bucket));
   if(duration)policy.seconds=Math.max(policy.seconds,Math.min(86400,duration));
  }
 }
 await pauseProvider(db,policy.seconds,now,policy.scope==='provider'?provider:key(provider,model));
 return policy.kind;
}
export const pauseModel=(db:UsageDb,provider:string,model:string,now:number)=>pauseProvider(db,30,now,key(provider,model));

/** OpenRouter platform free-model caps are shared across its free variants.
 * Only platform rate-limit headers trigger this scope; upstream model limits
 * remain isolated. Never infer scope from free-form error text.
 */
export const freeProviderCooldownSeconds=(db:UsageDb,provider:string,now:number)=>providerCooldownSeconds(db,now,'free:'+provider);
export async function recordFreeProviderLimit(db:UsageDb,provider:string,model:string,response:Response,now:number){
 if(provider!=='openrouter'||response.status!==429||!(model==='openrouter/free'||model.endsWith(':free'))||response.headers.get('X-RateLimit-Remaining')!=='0'||!response.headers.has('X-RateLimit-Limit'))return false;
 const raw=Number(response.headers.get('X-RateLimit-Reset'));
 const reset=raw>1e12?raw:raw>1e9?raw*1000:NaN;
 const seconds=Number.isFinite(reset)&&reset>now?Math.max(1,Math.min(86400,Math.ceil((reset-now)/1000))):failurePolicy(429,response.headers.get('Retry-After'),now).seconds;
 await pauseProvider(db,seconds,now,'free:'+provider);return true;
}

export function parseGroqDuration(value:string|null){
 if(!value||! /^(?:\d+(?:\.\d+)?(?:ms|[dhms]))+$/.test(value))return 0;
 const units:Record<string,number>={d:86400,h:3600,m:60,s:1,ms:.001};
 let seconds=0;for(const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|[dhms])/g))seconds+=Number(match[1])*units[match[2]];
 return Number.isFinite(seconds)?Math.ceil(seconds):0;
}
