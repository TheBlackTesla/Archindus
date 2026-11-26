export class MediaUnavailable extends Error{name='MediaUnavailable'}
export async function generateWorkerMedia(kind:'image'|'video',prompt:string,options:{version?:string;personalityId?:string;signal:AbortSignal;status?:(message:string)=>void;onModel?:(model:string)=>void},transport:typeof fetch=fetch.bind(globalThis)){
 const headers={'Content-Type':'application/json','X-Archindus-Account-Version':options.version??''};let id:string|undefined;
 const read=async(response:Response)=>{const data=await response.json();if(!response.ok){const e=new Error(data.error??'Media worker unavailable.');if(!id)e.name='MediaUnavailable';throw e}return data};
 try{
  options.signal.throwIfAborted();const job=await read(await transport('/api/archindus/media',{method:'POST',headers,body:JSON.stringify({kind,prompt:prompt.slice(0,2400),...(options.personalityId?{personalityId:options.personalityId}:{})}),signal:options.signal}));id=job.id;const model=job.model+' · ComfyUI';options.onModel?.(model);const deadline=Date.now()+(kind==='video'?600000:180000);
  while(Date.now()<deadline){options.signal.throwIfAborted();const state=await read(await transport('/api/archindus/media/'+id,{signal:options.signal,cache:'no-store'}));if(state.status==='complete'){const response=await transport('/api/archindus/media/'+id+'/file',{signal:options.signal});if(!response.ok)await read(response);const blob=await response.blob();if(blob.size>20000000||blob.type!==(kind==='image'?'image/png':'video/mp4'))throw Error('The media output was invalid.');return {blob,model}}
   if(state.status==='error'||state.status==='canceled')throw Error(state.error??'The media job '+state.status+'.');options.status?.(kind==='video'?'Ounumi is generating video on the connected GPU':'Ounumi is generating an image on the connected GPU');
   await new Promise<void>((resolve,reject)=>{const finish=()=>{clearTimeout(timer);options.signal.removeEventListener('abort',abort);resolve()},abort=()=>{clearTimeout(timer);options.signal.removeEventListener('abort',abort);reject(options.signal.reason)};const timer=setTimeout(finish,1500);options.signal.addEventListener('abort',abort,{once:true})});
  }throw Error('The media worker is taking longer than expected. The job may still finish on the worker.');
 }catch(e){if(id&&options.signal.aborted)void transport('/api/archindus/media/'+id,{method:'DELETE',headers,body:'{}',signal:AbortSignal.timeout(6000)}).catch(()=>{});throw e}
}

export async function generateCloudMedia(kind:'image'|'video',prompt:string,signal:AbortSignal){
 const response=await fetch('/api/archindus/cloud-media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,prompt}),signal});
 if(!response.ok){const data=await response.json();throw Error(data.error??'Media generation unavailable.')}
 let blob=await response.blob();
 if(kind==='image'&&blob.type==='image/jpeg'){
  const bitmap=await createImageBitmap(blob);
  try{
   if(bitmap.width>1536||bitmap.height>1536)throw Error('Image dimensions exceed the limit.');
   const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
   const context=canvas.getContext('2d');if(!context)throw Error('Image conversion unavailable.');
   context.drawImage(bitmap,0,0);
   blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Image conversion failed.')),'image/png'));
  }finally{bitmap.close();}
 }
 if(blob.size>20000000||blob.type!==(kind==='image'?'image/png':'video/mp4'))throw Error('The media output was invalid.');
 return {blob,model:response.headers.get('X-Archindus-Model')??'Model not reported'};
}
