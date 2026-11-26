import {baselineScore,ACTIVE_ROUTING_POLICY,SHADOW_ROUTING_POLICY,type OperationalEvidence} from './learning-policy';
import type {UsageDb} from './budget';
export async function recordModelOutcome(db:UsageDb,provider:string,model:string,task:string,success:boolean,elapsedMs:number,charged:number|undefined,now:number){
 const day=new Date(now).toISOString().slice(0,10);
 await db.prepare(`INSERT INTO routing_model_metrics (provider,model,task,day,attempts,successes,elapsed_ms,charged,unknown_usage)
 VALUES (?,?,?,?,1,?,?,?,?) ON CONFLICT(provider,model,task,day) DO UPDATE SET
 attempts=attempts+1,successes=successes+excluded.successes,elapsed_ms=elapsed_ms+excluded.elapsed_ms,
 charged=charged+excluded.charged,unknown_usage=unknown_usage+excluded.unknown_usage`)
 .bind(provider,model,task,day,success?1:0,Math.max(0,Math.round(elapsedMs)),charged??0,charged===undefined?1:0).run();
 // Fixed retention and bounded model/task aggregates, including temporary chats.
 await db.prepare('DELETE FROM routing_model_metrics WHERE day < ?').bind(new Date(now-30*86400000).toISOString().slice(0,10)).run();
}
export async function operationalEvidence(db:UsageDb,provider:string,model:string,task:string,now:number){
 const row=await db.prepare(`SELECT SUM(attempts) n,SUM(successes) s,SUM(elapsed_ms) ms,SUM(charged) charged,SUM(unknown_usage) unknownUsage FROM routing_model_metrics WHERE provider=? AND model=? AND task=? AND day>=?`)
 .bind(provider,model,task,new Date(now-7*86400000).toISOString().slice(0,10)).first<OperationalEvidence>();
 return row?.n?row:null;
}
export async function operationalScore(db:UsageDb,provider:string,model:string,task:string,now:number){
 return baselineScore(await operationalEvidence(db,provider,model,task,now));
}
export async function recordShadowDecision(db:UsageDb,task:string,disagreed:boolean,now:number){
 await db.prepare(`INSERT INTO routing_policy_shadow(day,task,champion,challenger,decisions,disagreements) VALUES(?,?,?,?,1,?)
 ON CONFLICT(day,task,champion,challenger) DO UPDATE SET decisions=decisions+1,disagreements=disagreements+excluded.disagreements`)
 .bind(new Date(now).toISOString().slice(0,10),task,ACTIVE_ROUTING_POLICY,SHADOW_ROUTING_POLICY,disagreed?1:0).run();
 await db.prepare('DELETE FROM routing_policy_shadow WHERE day < ?').bind(new Date(now-30*86400000).toISOString().slice(0,10)).run();
}
