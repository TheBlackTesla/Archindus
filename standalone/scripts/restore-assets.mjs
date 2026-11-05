import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const assets=JSON.parse(await readFile(new URL('./runtime-assets.json',import.meta.url),'utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
for(const asset of assets){
 const target=resolve(root,asset.path);if(!target.startsWith(root+'/public/'))throw Error('Unexpected asset path');
 const existing=await readFile(target).catch(e=>{if(e.code!=='ENOENT')throw e;return null});
 if(existing&&existing.length===asset.bytes&&hash(existing)===asset.sha256)continue;
 const response=await fetch(asset.url,{signal:AbortSignal.timeout(60000),redirect:'error'});
 if(!response.ok)throw Error(`Asset download failed: ${asset.path} (${response.status})`);
 const data=Buffer.from(await response.arrayBuffer());
 if(data.length!==asset.bytes||hash(data)!==asset.sha256)throw Error(`Asset integrity mismatch: ${asset.path}`);
 await mkdir(dirname(target),{recursive:true});await writeFile(target+'.tmp',data);await rename(target+'.tmp',target);
 console.log(`Restored verified asset: ${asset.path}`);
}
console.log('Runtime assets verified.');
