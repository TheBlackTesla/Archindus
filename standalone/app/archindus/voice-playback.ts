import {VOICE_AUDIO_LIMIT} from './voice-config';
// One cancellable player per tab. No cross-user or persistent audio cache.
export class VoicePlayback{
 private controller?:AbortController;private audio?:HTMLAudioElement;private url?:string;private generation=0;private cached?:{text:string;blob:Blob};
 constructor(private transport:typeof fetch=fetch.bind(globalThis),private createAudio:(url:string)=>HTMLAudioElement=url=>new Audio(url),private urls:{createObjectURL:(blob:Blob)=>string;revokeObjectURL:(url:string)=>void}=URL){}
 stop(){this.generation++;this.controller?.abort();this.controller=undefined;if(this.audio){this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.audio=undefined}if(this.url){this.urls.revokeObjectURL(this.url);this.url=undefined}}
 clear(){this.stop();this.cached=undefined}
 async speak(text:string,onStart:()=>void,onEnd:()=>void,onError?:(message:string)=>void){
  this.stop();const generation=this.generation,controller=new AbortController();this.controller=controller;
  try{
   let blob=this.cached?.text===text?this.cached.blob:undefined;
   if(!blob){const response=await this.transport('/api/archindus/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal});if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error??'Archindus voice is unavailable.')}if(!response.headers.get('content-type')?.includes('audio/'))throw Error('No voice audio was returned.');blob=await response.blob();if(blob.size>VOICE_AUDIO_LIMIT)throw Error('Voice audio is too large.');}
   if(generation!==this.generation)return;
   this.cached={text,blob};this.url=this.urls.createObjectURL(blob);const audio=this.createAudio(this.url);this.audio=audio;
   audio.onplaying=()=>{if(generation===this.generation)onStart()};
   audio.onended=()=>{if(generation===this.generation){this.stop();onEnd()}};
   audio.onerror=()=>{if(generation===this.generation){this.stop();onEnd();onError?.('Voice audio could not play. Tap Listen to try again.')}};
   try{await audio.play()}catch(e){if(e instanceof Error&&e.name==='NotAllowedError')throw Error('Your browser paused voice playback. Tap Listen to play the prepared audio.');throw e};
  }catch(e){if(generation!==this.generation||controller.signal.aborted)return;this.stop();throw e}
 }
}
