export type BrowserVoice={name:string;lang:string;voiceURI:string;localService:boolean;default?:boolean};
// Web Speech supplies no gender field. Match known voice names and explicit
// provider labels, never infer gender merely from a locale or arbitrary name.
const femaleName=/(?:\bfemale\b|\b(?:leah|tessa|sonia|libby|hazel|susan|serena|kate|martha|moira|fiona|hollie)\b)/i;
export function preferredBrowserVoice<T extends BrowserVoice>(voices:T[],deviceOnly:boolean,selectedURI=''):T|undefined{
 const eligible=voices.filter(v=>!deviceOnly||v.localService);
 const explicit=eligible.find(v=>v.voiceURI===selectedURI);if(explicit)return explicit;
 const rank=(v:T)=>{const lang=v.lang.replace(/_/g,'-').toLowerCase(),female=femaleName.test(v.name.replace(/Neural/g,' '));if(!/^en(?:-|$)/.test(lang))return 0;const region=lang==='en-za'?300:/^en-(gb|ie|mt|gi|im|gg|je)$/.test(lang)?200:0;return (female&&region?1000+region:region?100+region:female?80:50)+(v.localService?2:0)};
 return eligible.map((v,i)=>({v,i,rank:rank(v)})).sort((a,b)=>b.rank-a.rank||a.i-b.i)[0]?.v;
}
export function matchesPreferredVoice(voice?:BrowserVoice){return !!voice&&/^en[-_](za|gb|ie|mt|gi|im|gg|je)$/i.test(voice.lang)&&femaleName.test(voice.name.replace(/Neural/g,' '))}
export function loadBrowserVoices(synth:SpeechSynthesis,timeout=1200):Promise<SpeechSynthesisVoice[]>{
 const current=synth.getVoices();if(current.length)return Promise.resolve(current);
 return new Promise(resolve=>{const finish=()=>{clearTimeout(timer);synth.removeEventListener('voiceschanged',changed);resolve(synth.getVoices())};const changed=()=>{if(synth.getVoices().length)finish()};const timer=setTimeout(finish,timeout);synth.addEventListener('voiceschanged',changed);changed()});
}
