import {z} from 'zod';
import {boundedAccountJson,type AccountDb} from './account';

export type ProjectBucket={
 put(key:string,body:string):Promise<unknown>;
 get(key:string):Promise<{text():Promise<string>}|null>;
 delete(key:string|string[]):Promise<unknown>;
};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie'}});
const idSchema=z.string().uuid();
const source=z.object({fileId:idSchema,fileName:z.string().max(120),location:z.string().max(80),text:z.string().max(1600),page:z.number().int().positive().max(500).optional()});
const brief=z.object({question:z.string().max(2000),sources:z.array(source).max(18),findings:z.array(z.object({text:z.string().max(1600),source:z.number().int().min(0).max(17)})).max(36),review:z.array(z.string().max(1000)).max(12),summary:z.string().max(8000),modelReview:z.object({text:z.string().max(6500),model:z.string().max(250)}).optional()});
const file=z.object({id:idSchema,name:z.string().min(1).max(120).regex(/\.(pdf|docx|csv|md|txt|json)$/i),data:z.string().min(4).max(7_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/)});
const bundle=z.object({title:z.string().trim().min(1).max(120),revision:idSchema.nullable(),files:z.array(file).min(1).max(3),briefs:z.array(brief).max(12)}).strict().refine(value=>{
 const ids=new Set(value.files.map(f=>f.id));
 return value.briefs.every(b=>b.sources.every(s=>ids.has(s.fileId))&&b.findings.every(f=>f.source<b.sources.length));
},'Every citation must point to a passage in a project file.');
export type SourceBundle=z.infer<typeof bundle>;
type Row={id:string;title:string;revision:string;object_key:string;updated_at:number};
export async function handleProjects(req:Request,db:AccountDb,bucket:ProjectBucket|undefined,owner:string,version:string,path:string[]){
 if(!bucket)return json({error:'Project file storage is unavailable.'},503);
 if(path.length>2||path[1]&&!idSchema.safeParse(path[1]).success)return json({error:'Invalid project.'},400);
 const id=path[1];
 if(!id&&req.method==='GET'){const rows=await db.prepare('SELECT id,title,revision,updated_at AS updatedAt FROM source_projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 30').bind(owner).all();return json({projects:rows.results})}
 if(!id)return json({error:'Choose a project.'},400);
 const current=await db.prepare('SELECT * FROM source_projects WHERE id=? AND user_id=?').bind(id,owner).first<Row>();
 if(req.method==='GET'){
   if(!current)return json({error:'Project not found.'},404);
   const object=await bucket.get(current.object_key);if(!object)return json({error:'Project file unavailable.'},503);
   return new Response(await object.text(),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
 }
 if(req.method==='DELETE'){
   if(!current)return json({deleted:true});
   const row=await db.prepare('DELETE FROM source_projects WHERE user_id=? AND id=? AND revision=? RETURNING object_key').bind(owner,id,current.revision).first<{object_key:string}>();
   if(!row)return json({error:'This project changed. Reopen it before deleting.'},409);
   await bucket.delete(row.object_key);return json({deleted:true});
 }
 if(req.method!=='PUT')return json({error:'Method not allowed.'},405);
 const data=bundle.parse(await boundedAccountJson(req,8_800_000));
 if(data.files.reduce((n,f)=>n+f.data.length,0)>8_000_000)return json({error:'Saved projects support up to 6 MB of original files combined.'},413);
 if(new Set(data.files.map(f=>f.id)).size!==data.files.length)return json({error:'Duplicate source file.'},400);
 if((current?.revision??null)!==data.revision)return json({error:'This project changed in another tab. Reopen it before saving.'},409);
 const revision=crypto.randomUUID(),key='projects/'+version+'/'+id+'/'+revision;
 await bucket.put(key,JSON.stringify({...data,revision}));
 const row=await db.prepare(`INSERT INTO source_projects(id,user_id,title,revision,object_key,updated_at)
 SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM account_profiles WHERE user_id=? AND history_enabled=1 AND data_version=?)
 AND ((? IS NULL AND (SELECT COUNT(*) FROM source_projects WHERE user_id=?)<30) OR EXISTS(SELECT 1 FROM source_projects WHERE id=? AND user_id=? AND revision=?))
 ON CONFLICT(id) DO UPDATE SET title=excluded.title,revision=excluded.revision,object_key=excluded.object_key,updated_at=excluded.updated_at
 WHERE source_projects.user_id=excluded.user_id AND source_projects.revision=? RETURNING id`)
 .bind(id,owner,data.title,revision,key,Date.now(),owner,version,data.revision,owner,id,owner,data.revision,data.revision).first();
 if(!row){await bucket.delete(key);return json({error:'History is disabled, the project changed, or your account has reached 30 projects.'},409)}
 if(current)await bucket.delete(current.object_key);
 return json({id,revision});
}
