import type {PublicModel} from '../../lib/inference/providers';
import {AGENTS,type AgentId} from './agents';
import {MODEL_CATALOG} from '../../lib/inference/models';
import type {Personality} from './personalities';
export type BrainRuntime={extraModels?:PublicModel[];openAIConfigured?:boolean;hosted:boolean|null;deviceOnly:boolean;privateOnline?:boolean;native?:boolean;localModels?:{id:string;label:string}[]};
export type NeuralEntity={id:string;name:string;role:string;kind:'router'|'personality'|'model'|'empty';mark:string;color:string;position:{x:number;y:number;z:number};agentId?:AgentId;personality?:Personality;modelId?:string;availability?:string;license?:string;architecture?:string;provider?:string};
export type BrainRun={status?:string;agentId?:AgentId;model?:string;task?:string;routeReason?:string;personalityId?:string;personalityName?:string;run?:{engine:string;firstTextMs?:number;elapsedMs:number}};
const sphere=(i:number,count:number,r=1)=>{const y=1-2*((i+.5)/count),angle=i*Math.PI*(3-Math.sqrt(5)),ring=Math.sqrt(1-y*y);return {x:Math.cos(angle)*ring*r,y:y*r,z:Math.sin(angle)*ring*r}};
const point=(x:number,y:number,z:number)=>({x,y,z});
const rolePositions=[point(.08,-.42,.8),point(-.76,-.1,.48),point(-.4,-.67,.3),point(.68,-.2,.58),point(.32,.61,.65),point(.7,.42,-.12)];
const modelPositions=[point(-.1,.36,.9),point(.63,-.57,.08),point(-.7,.46,.28),point(-.15,-.87,-.2)];
const roleColors:Record<AgentId,string>={architect:'#b8dfe9',satoshi:'#91dcff',datadoc:'#8de6ca',socrates:'#e8d39c',ounumi:'#c8adff',wolf:'#e7b0bf'};
export function livingEntities(personalities:Personality[],runtime:BrainRuntime,observedModel?:string):NeuralEntity[]{
 const cloud=runtime.openAIConfigured===false?'Setup required':runtime.deviceOnly?'Off · device-only mode':runtime.hosted===null?'Availability not yet confirmed':runtime.hosted?'Available within usage limits':'Hosted service unavailable';
 const assigned=new Map<number,Personality>();for(const p of personalities){const slot=Number.isInteger(p.nodeSlot)&&p.nodeSlot!>=0&&p.nodeSlot!<20&&!assigned.has(p.nodeSlot!)?p.nodeSlot!:Array.from({length:20},(_,i)=>i).find(i=>!assigned.has(i));if(slot!==undefined)assigned.set(slot,p)}
 const nodes:NeuralEntity[]=[{id:'router',name:'Archindus',role:'Objective router',kind:'router',mark:'A',color:'#b6eaff',position:point(0,0,.08)},
 ...AGENTS.map((a,i)=>({id:'agent:'+a.id,name:a.id==='architect'?'General':a.name,role:a.role,kind:'personality' as const,mark:a.mark,color:roleColors[a.id],position:rolePositions[i],agentId:a.id})),
 ...MODEL_CATALOG.map((m,i)=>({id:'model:'+m.id,name:m.name,role:m.tier,kind:'model' as const,mark:['Lu','Te','So','As'][i],color:'#aacbdf',position:modelPositions[i],modelId:m.id,availability:cloud})),
 {id:'model:image',name:'GPT Image mini',role:'Image model',kind:'model',mark:'Im',color:'#c5b6e5',position:point(.1,.77,-.22),modelId:'gpt-image-1-mini',availability:cloud},
 {id:'model:private',name:'Private Qwen',role:'Private model endpoint',kind:'model',mark:'Q',color:'#9bc6bc',position:point(.93,.15,-.6),availability:runtime.deviceOnly?'Off · device-only mode':runtime.privateOnline?'Private server online':'Private server offline'},
 {id:'model:tools',name:'Local tools',role:'JSON · CSV · routing',kind:'model',mark:'{}',color:'#a5bbcc',position:point(-.83,-.25,-.57),availability:'On-device tools · no LLM required'},
 ...Array.from({length:20},(_,i)=>{const p=assigned.get(i);return {id:p?'custom:'+p.id:'empty:'+i,name:p?p.name:'Create personality',role:p?p.description:'Open personality slot',kind:p?'personality' as const:'empty' as const,mark:p?p.name.slice(0,2).toUpperCase():'+',color:p?'#8ee5ca':'#708c9e',position:sphere(i,20,.88),...(p?{agentId:p.capability,personality:p}:{})}}),
 ...(runtime.extraModels??[]).slice(0,60).map((m,i,all)=>({id:'provider:'+m.id,name:m.name+' · '+m.providerName,role:m.kind==='chat'?'Text model':m.kind==='image'?'Image model':'Video model',kind:'model' as const,mark:m.kind==='video'?'V':m.kind==='image'?'I':m.name.slice(0,2),color:m.configured?'#a9d7d0':'#5e7889',position:sphere(i,all.length,.96),modelId:m.modelId,availability:m.state,provider:m.providerName,license:m.license,architecture:m.architecture})),
 ...(runtime.native?[{id:'model:native',name:'Browser AI',role:'Built-in model',kind:'model' as const,mark:'AI',color:'#abd5ca',position:point(-.25,.7,-.8),availability:'Installed browser model'}]:[]),
 ...(runtime.localModels??[]).map((m,i)=>({id:'model:local:'+m.id,name:m.label,role:'Saved device model',kind:'model' as const,mark:'Q',color:'#9dc9d7',position:sphere(i+2,8,1.12),modelId:m.id,availability:'Saved on this device · runtime readiness varies'}))];
 if(observedModel&&!resolveModelNode(observedModel,nodes))nodes.push({id:'model:observed',name:observedModel,role:'Observed execution engine',kind:'model',mark:'E',color:'#a9dcde',position:point(.44,.2,-.85),availability:'Reported by this request'});
 return nodes;
}
export function resolveModelNode(model:string|undefined,nodes:NeuralEntity[]):string|undefined{
 if(!model)return undefined;const m=model.toLowerCase();
 const direct=nodes.find(n=>n.kind==='model'&&n.modelId&&(m.includes(n.modelId.toLowerCase())||m===n.name.toLowerCase()));if(direct)return direct.id;
 const named=nodes.find(n=>n.kind==='model'&&m===n.name.toLowerCase());if(named)return named.id;
 if(/image|diffusion/.test(m))return nodes.find(n=>n.id==='model:image')?.id;
 if(/private.*qwen|qwen.*private/.test(m))return nodes.find(n=>n.id==='model:private')?.id;
 if(/^(archindus|browser (?:json parser|tool|csv|route)|local tools)/i.test(model))return 'model:tools';
 if(/native|built-in/.test(m))return nodes.find(n=>n.id==='model:native')?.id;
 return undefined;
}
export function requestPath(run:BrainRun|undefined,nodes:NeuralEntity[]){
 if(!run)return [];const path=['router'];
 if(!run.task&&!run.model&&run.status==='generating')return path;
 const persona=run.personalityId?'custom:'+run.personalityId:'agent:'+(run.agentId??'architect');
 if(nodes.some(n=>n.id===persona))path.push(persona);
 const model=resolveModelNode(run.model,nodes);if(model)path.push(model);
 return path;
}
export function neuralLinks(nodes:NeuralEntity[],path:string[]=[]):[string,string][]{
 const links:[string,string][]=[];const add=(a:string,b:string)=>{if(a!==b&&!links.some(([x,y])=>x===a&&y===b||x===b&&y===a))links.push([a,b])};
 const personalities=nodes.filter(n=>n.kind==='personality'),models=nodes.filter(n=>n.kind==='model');
 for(const n of personalities){add('router',n.id);for(const model of models)if(model.id!=='model:image'||n.agentId==='ounumi')add(n.id,model.id)}
 for(let i=0;i<path.length-1;i++)add(path[i],path[i+1]);return links;
}
export function projectNeuron(position:{x:number;y:number;z:number},yaw:number,pitch:number,width:number,height:number,zoom=1,expansion=1){
 const cy=Math.cos(yaw),sy=Math.sin(yaw),ct=Math.cos(pitch),st=Math.sin(pitch),x=position.x*cy-position.z*sy,z=position.x*sy+position.z*cy,y=position.y*ct-z*st,depth=position.y*st+z*ct;
 const perspective=3.8/(3.8-depth),radius=Math.min(width*.4,height*.43)*zoom*(.84+.16*expansion);
 return {x:width/2+x*radius*perspective,y:height/2+y*radius*perspective,depth,scale:perspective,opacity:.38+.62*(depth+1.2)/2.4};
}
