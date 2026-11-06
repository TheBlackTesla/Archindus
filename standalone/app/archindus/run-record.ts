import type { EngineMode } from "./execution";
export const engineLabel: Record<EngineMode,string>={hosted:"Hosted API",qwen:"Private server",native:"Built-in browser AI",webgpu:"Browser GPU",cpu:"Browser CPU"};
export type RunRecord={engine:string;elapsedMs:number;firstTextMs?:number;attempts:{engine:string;state:"completed"|"unavailable"|"stopped"}[]};
export function duration(ms:number) {return ms<1?"<1 ms":ms<1000?Math.round(ms)+" ms":(ms/1000).toFixed(1)+" s";}
export function chatModes(o:{deviceOnly:boolean;ready?:"webgpu"|"cpu";saved:("webgpu"|"cpu")[];native:boolean;hosted:boolean|null;qwen:boolean}):EngineMode[] {
  // Availability is a display hint, not admission control. It may be stale
  // after an outage or temporary limit. The server authorizes every paid call.
  const modes: EngineMode[]=[];
  if(o.ready)modes.push(o.ready);if(o.native)modes.push("native");
  if(!o.deviceOnly){if(o.qwen)modes.push("qwen");modes.push("hosted");}
  return [...new Set([...modes,...o.saved])];
}

export function runModelLabel(model?:string){
 if(!model)return "Model not reported";
 if(model in engineLabel)return "Model not reported · "+engineLabel[model as EngineMode];
 if(model==="Archindus"||model==="Archindus memory")return model+" · built-in reply (no LLM)";
 if(model==="Built-in browser AI")return model+" · model identity not exposed by browser";
 return model;
}
