import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const assets=JSON.parse(await readFile(new URL('./runtime-assets.json',import.meta.url),'utf8'));
for(const asset of assets){
 const target=resolve(root,asset.path);
 if(!target.startsWith(root+'/public/'))throw Error('Unexpected asset path');
 const data=await readFile(target).catch(e=>{if(e.code!=='ENOENT')throw e;throw Error(`Missing bundled asset: ${asset.path}. Restore it from the full source checkout.`)});
 const hash=createHash('sha256').update(data).digest('hex');
 if(data.length!==asset.bytes||hash!==asset.sha256)throw Error(`Asset integrity mismatch: ${asset.path}`);
}
console.log('Bundled runtime assets verified.');
