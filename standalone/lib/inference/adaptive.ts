import {operationalEvidence,recordShadowDecision} from './metrics';
import {policyOrder,ACTIVE_ROUTING_POLICY,SHADOW_ROUTING_POLICY} from './learning-policy';
import arenaBaseline from './arena-baseline.json';
import {z} from 'zod';
import {boundedAccountJson,accountIdentity,type AccountDb} from '../account';
import {boundedProviderJson,type Provider,type RouteModel} from './providers';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function adaptiveAccount(request:Request,db:AccountDb,user:string,version:string,path:string){
 if(request.method==='GET')return response({records:(await db.prepare('SELECT item,model,task,rating FROM account_routing_feedback WHERE user_id=?').bind(user).all()).results});
 if(request.method==='DELETE'){await boundedAccountJson(request,1000);await db.prepare('DELETE FROM account_routing_feedback WHERE user_id=?').bind(user).run();return response({cleared:true})}
 const data=z.object({conversationId:z.string().uuid(),messageId:z.string().max(80),rating:z.union([z.literal(-1),z.literal(1)]).optional(),prefer:z.boolean().optional()}).strict().parse(await boundedAccountJson(request,2000));
 const row=await db.prepare('SELECT messages FROM account_conversations WHERE id=? AND user_id=?').bind(data.conversationId,user).first<{messages:string}>();
 const message=row?JSON.parse(row.messages).find((m:{id:string;role:string;status:string})=>m.id===data.messageId&&m.role==='assistant'&&m.status==='complete'):null;
 if(!message?.model)return response({error:'Save the conversation before rating this response.'},409);
 const item=data.prefer?'preferred':data.conversationId+'/'+data.messageId;
 if(!data.prefer&&data.rating===undefined)return response({error:'Select a rating.'},400);
 await db.prepare('INSERT INTO account_routing_feedback(user_id,item,model,task,rating) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM account_profiles WHERE user_id=? AND data_version=?) ON CONFLICT(user_id,item) DO UPDATE SET model=excluded.model,task=excluded.task,rating=excluded.rating').bind(user,item,message.model,message.task??'chat',data.rating??0,user,version).run();
 return response({saved:true});
}
type Candidate={provider:Provider;model:RouteModel};
type Vote={item:string;model:string;task:string;rating:number};
type Evidence={hf:any[];arena:any[];expires:number};
let evidence:Evidence={hf:[],arena:arenaBaseline,expires:0},pending:Promise<void>|undefined;
async function refresh(send:typeof fetch,now:number){
 if(evidence.expires>now)return;
 pending??=(async()=>{
  const get=async(url:string)=>{const r=await send(url,{redirect:'manual',signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error();return boundedProviderJson(r,2000000)};
  const results=await Promise.allSettled([get('https://router.huggingface.co/v1/models'),get('https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=text&split=latest&offset=0&length=100')]);
  evidence={hf:results[0].status==='fulfilled'&&Array.isArray(results[0].value.data)?results[0].value.data:[],arena:results[1].status==='fulfilled'&&Array.isArray(results[1].value.rows)?[...results[1].value.rows.map((r:any)=>r.row),...arenaBaseline]:arenaBaseline,expires:now+6*3600000};
 })().finally(()=>{pending=undefined});
 await pending;
}
export function personalScore(votes:Vote[],id:string,task:string){
 const base=id.split(':')[0],match=(v:Vote)=>v.model.includes('('+id+')')||v.model.includes('('+base+')');
 const ratings=votes.filter(v=>v.item!=='preferred'&&v.task===task&&match(v));
 return ratings.reduce((n,v)=>n+v.rating,0)/(ratings.length+10)*.15+(votes.some(v=>v.item==='preferred'&&match(v))?.2:0);
}
export async function adaptiveRankings(candidates:Candidate[],request:Request,db:AccountDb,task:string,temporary:boolean,send:typeof fetch,now:number,record=true){
 await refresh(send,now);let votes:Vote[]=[];
 const user=temporary?null:accountIdentity(request);
 if(user)try{votes=(await db.prepare('SELECT item,model,task,rating FROM account_routing_feedback WHERE user_id=? LIMIT 1000').bind(user.id).all<Vote>()).results}catch{}
 const operations=new Map(await Promise.all(candidates.map(async c=>[c.provider.id+':'+c.model.id,await operationalEvidence(db,c.provider.id,c.model.id,task,now).catch(()=>null)] as const)));
 const aliases:Record<string,string>={'Qwen/Qwen3.8-27B':'Qwen3.8-27B','openai/gpt-oss-20b':'gpt-oss-20b','meta-llama/Llama-3.1-8B-Instruct':'Llama 3.1 8B Instruct'};
 const score=(c:Candidate)=>{
  const category=task==='code'?'coding':task==='analysis'?'math':task==='document'?'creative_writing':'overall';
  const arena=evidence.arena.find(r=>r?.model_name===aliases[c.model.id.split(':')[0]]&&r.category===category&&r.vote_count>=100&&Number.isFinite(r.rating)&&now-Date.parse(r.leaderboard_publish_date)<30*86400000);
  return personalScore(votes,c.model.id,task)+(arena?Math.max(-.15,Math.min(.15,(arena.rating-1100)/2000)):0)-Math.min(.5,(c.model.input+c.model.output*2)/100);
 };
 const eligible=candidates.filter(c=>{
  if(c.provider.id!=='huggingface')return true;
  const [id,provider]=c.model.id.split(':');const p=evidence.hf.find(m=>m?.id===id)?.providers?.find((p:any)=>p.provider===provider);
  return !p||(p.status==='live'&&(!p.pricing||(p.pricing.input<=c.model.input+1e-6&&p.pricing.output<=c.model.output+1e-6)));
 });
 const routeId=(c:Candidate)=>c.provider.id+':'+c.model.id;
 const records=eligible.map(c=>({id:routeId(c),free:c.model.input===0&&c.model.output===0,base:score(c),evidence:operations.get(routeId(c))??null}));
 const champion=policyOrder(records,ACTIVE_ROUTING_POLICY),challenger=policyOrder(records,SHADOW_ROUTING_POLICY);
 if(record&&champion.length)await recordShadowDecision(db,task,champion[0]!==challenger[0],now).catch(()=>{});
 const byId=new Map(eligible.map(c=>[routeId(c),c]));
 return {champion:champion.map(id=>byId.get(id)!),challenger:challenger.map(id=>byId.get(id)!),evidence:records};
}

export async function adaptiveOrder(...args:Parameters<typeof adaptiveRankings>){return (await adaptiveRankings(...args)).champion;}
