/** Versioned, deterministic policies. A completion check is not a quality label. */
export const ACTIVE_ROUTING_POLICY='operational-v1';
export const SHADOW_ROUTING_POLICY='confidence-v2';
export type OperationalEvidence={n:number;s:number;ms:number;charged:number;unknownUsage:number};
export function baselineScore(row:OperationalEvidence|null){
 if(!row||row.n<5)return 0;
 return Math.max(-.25,Math.min(.15,((row.s+5)/(row.n+10)-.5)*.5-Math.min(.05,row.ms/row.n/1200000)));
}
export function confidenceScore(row:OperationalEvidence|null){
 if(!row||row.n<20||![row.n,row.s,row.ms,row.charged,row.unknownUsage].every(Number.isFinite)||!Number.isSafeInteger(row.n)||!Number.isSafeInteger(row.s)||row.s<0||row.s>row.n||row.ms<0||row.charged<0||row.unknownUsage<0||row.unknownUsage>row.n)return 0;
 const z=1.96,p=row.s/row.n;
 const lower=(p+z*z/(2*row.n)-z*Math.sqrt((p*(1-p)+z*z/(4*row.n))/row.n))/(1+z*z/row.n);
 const latency=Math.min(.03,Math.max(0,row.ms/row.n)/2000000);
 const uncertainty=Math.min(.05,Math.max(0,row.unknownUsage)/row.n*.05);
 return Math.max(-.2,Math.min(.15,(lower-.5)*.35-latency-uncertainty));
}
export type ScoredRoute={id:string;free:boolean;base:number;evidence:OperationalEvidence|null};
export function policyOrder(routes:ScoredRoute[],version=ACTIVE_ROUTING_POLICY){
 const score=version===SHADOW_ROUTING_POLICY?confidenceScore:baselineScore;
 return routes.map((r,index)=>({...r,index,value:r.base+score(r.evidence)})).sort((a,b)=>a.free!==b.free?(a.free?-1:1):b.value-a.value||a.index-b.index).map(r=>r.id);
}
export function promotionGate(input:{regressions:number;qualitySamples:number;qualityLowerBound:number;costRatio:number;latencyRatio:number}){
 const reasons:string[]=[];
 if(input.regressions!==0)reasons.push('Routing invariant regressions');
 if(!Number.isSafeInteger(input.qualitySamples)||input.qualitySamples<200)reasons.push('At least 200 independently evaluated outcomes required');
 if(!Number.isFinite(input.qualityLowerBound)||input.qualityLowerBound<0)reasons.push('Quality improvement is not established');
 if(input.qualityLowerBound===0&&input.costRatio>=.98&&input.latencyRatio>=.95)reasons.push('No measured quality, cost or latency improvement');
 if(!Number.isFinite(input.costRatio)||input.costRatio>1.05||input.costRatio<0)reasons.push('Cost regression or missing cost evidence');
 if(!Number.isFinite(input.latencyRatio)||input.latencyRatio>1.1||input.latencyRatio<0)reasons.push('Latency regression or missing latency evidence');
 return {eligible:reasons.length===0,reasons};
}
