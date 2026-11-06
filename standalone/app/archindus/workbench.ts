import {getAgent,type AgentId} from "./agents";
import type {ContextMessage} from "./answer";
import type {Attachment} from "./artifacts";
import {fallbackPlan} from "./orchestration";
import type {ExecutionResult} from "./execution";
export function workbench(input:string,agent:AgentId,history:ContextMessage[],files:Attachment[]):ExecutionResult|undefined {
  const m=/^\/(route|json)(?:\s+([\s\S]*))?$/i.exec(input.trim());if(!m)return;
  const route=m[1].toLowerCase()==="route",arg=m[2]?.trim()??"",plan=fallbackPlan(route&&arg?arg:input,agent,history);
  const result=(text:string)=>({text,model:route?"Local route inspector":"Browser JSON parser",plan:{...plan,reason:route?"Inspected the demo router without executing the objective.":"Parsed locally with JSON.parse. No model was called."}});
  if(route)return result(arg?"## Route preview\n"+getAgent(plan.primaryId).name+" · "+plan.task+"\n\n"+plan.reason+"\n\nThis preview does not execute the objective.":"Add an objective after /route to inspect its route.");
  const file=files.find(f=>/\.json$/i.test(f.name));if(!arg&&file?.truncated)return result("This file is too large. Supply a smaller complete JSON document.");
  const source=arg||file?.text;if(!source)return result("Paste JSON after /json, or attach a JSON file and send /json.");
  try{const v=JSON.parse(source),type=(x:unknown)=>x===null?"null":Array.isArray(x)?"array":typeof x;
    const keys=type(v)==="object"?Object.keys(v):[];
    const shape=Array.isArray(v)?{root:"array",items:v.length,sampleTypes:[...new Set(v.slice(0,25).map(type))]}:type(v)==="object"?{root:"object",keys:keys.length,fields:Object.fromEntries(keys.slice(0,24).map(k=>[k.slice(0,100),type(v[k])]))}:{root:type(v)};
    const fence=String.fromCharCode(96).repeat(3);
    return result("## Valid JSON\n"+new TextEncoder().encode(source).length+" UTF-8 bytes · parsed on this device.\n\n"+fence+"json\n"+JSON.stringify(shape,null,2).replaceAll(String.fromCharCode(96),"\\u0060")+"\n"+fence);
  }catch(cause){const pos=cause instanceof Error?/(?:position \d+|line \d+ column \d+)/i.exec(cause.message)?.[0]:undefined;return result("## Invalid JSON\nThe parser rejected this input"+(pos?" at "+pos:"")+". Check quotes, brackets, and trailing commas.");}
}
