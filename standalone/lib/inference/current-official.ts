export async function currentOfficial(send:typeof fetch=fetch){
 const source='https://www.usa.gov/presidents';
 try{
 const r=await send(source,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'manual',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error();
 const reader=r.body?.getReader();if(!reader)throw Error();let html='';let size=0;const decoder=new TextDecoder();try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>1000000){await reader.cancel();throw Error()}html+=decoder.decode(p.value,{stream:true})}}finally{reader.releaseLock()}
 const plain=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
 const name=/current president of the United States is\s+([A-Z][A-Za-z .'-]{2,80})\./i.exec(plain)?.[1]?.trim();if(!name)throw Error();
 return Response.json({text:`The current President of the United States is **${name}**.\n\nSource: [USAGov](${source}) · checked ${new Date().toISOString().slice(0,10)}.`,model:'USAGov · live official source'},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({text:'I could not verify the current U.S. president from the official source right now. Please check https://www.usa.gov/presidents rather than relying on an older model answer.',model:'Archindus · verification unavailable'},{headers:{'Cache-Control':'no-store'}})}
}
