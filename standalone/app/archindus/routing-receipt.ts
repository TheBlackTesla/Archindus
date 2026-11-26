export type RoutingAttempt={model:string;outcome:'complete'|'invalid_output'|'unavailable'|'rate_limit'|'authentication'|'credits'|'model_unavailable'|'invalid_request'|'service_unavailable'|'blocked'|'refused';elapsedMs:number;reservedMicrodollars:number;chargedMicrodollars?:number};
export type RoutingReceipt={policyVersion?:string;shadowPolicyVersion?:string;attempts:RoutingAttempt[]};
export function readReceipt(value:unknown):RoutingReceipt|undefined{
 if(!value||typeof value!=='object'||!Array.isArray((value as RoutingReceipt).attempts))return;
 const attempts=(value as RoutingReceipt).attempts;
 if(attempts.length>6||attempts.some(a=>!a||typeof a.model!=='string'||a.model.length>250||typeof a.outcome!=='string'||!Number.isFinite(a.elapsedMs)||a.elapsedMs<0||!Number.isSafeInteger(a.reservedMicrodollars)||a.reservedMicrodollars<0))return;
 const receipt=value as RoutingReceipt;
 return {attempts,...(typeof receipt.policyVersion==='string'&&receipt.policyVersion.length<=60?{policyVersion:receipt.policyVersion}:{}),...(typeof receipt.shadowPolicyVersion==='string'&&receipt.shadowPolicyVersion.length<=60?{shadowPolicyVersion:receipt.shadowPolicyVersion}:{})};
}
