import {AGENTS,type AgentId} from './agents';
import type {Personality} from './personalities';
export const MAP_WIDTH=1380,MAP_HEIGHT=800;
export type MapView={zoom:number;x:number;y:number};
export const DEFAULT_VIEW:MapView={zoom:1,x:0,y:0};
export function zoomMap(v:MapView,next:number,anchor={x:690,y:400}):MapView{const zoom=Math.max(.65,Math.min(3.5,next)),r=zoom/v.zoom;return {zoom,x:(anchor.x-690)*(1-r)+v.x*r,y:(anchor.y-400)*(1-r)+v.y*r};}
export type BrainNode={id:string;name:string;sub:string;x:number;y:number;color:string;kind:string;mark:string;agentId?:AgentId;personality?:Personality};
const positions:Record<string,[number,number,string]>={satoshi:[360,185,'#6ad7ff'],datadoc:[600,185,'#77e1bd'],ounumi:[720,400,'#ba9bff'],socrates:[600,615,'#e9c67f'],wolf:[360,615,'#ed9ba9'],architect:[240,400,'#b4c8d5']};
export function brainNodes(personalities:Personality[]=[]):BrainNode[]{return [
 {id:'input',name:'Your objective',sub:'Conversation · context',x:90,y:400,color:'#91b2c5',kind:'input',mark:'→'},
 {id:'router',name:'Archindus router',sub:'Intent · privacy · cost · availability',x:480,y:400,color:'#8ddaff',kind:'router',mark:'A'},
 ...AGENTS.map(a=>({id:'agent:'+a.id,name:a.id==='architect'?'General':a.name,sub:a.role,x:positions[a.id][0],y:positions[a.id][1],color:positions[a.id][2],kind:'personality',mark:a.mark,agentId:a.id})),
 ...personalities.map((p,i)=>({id:'custom:'+p.id,name:p.name,sub:'Your personality',x:480+315*Math.cos(-Math.PI/2+i*2*Math.PI/Math.max(1,personalities.length)),y:400+315*Math.sin(-Math.PI/2+i*2*Math.PI/Math.max(1,personalities.length)),color:'#83e5cc',kind:'custom',mark:p.name.slice(0,2).toUpperCase(),agentId:p.capability,personality:p})),
 ...[['luna','GPT-6 Luna','Everyday · economical'],['terra','GPT-6.1 Terra','Writing · analysis'],['sol','GPT-6.1 Sol','Software · coding'],['astra','GPT-6 Astra','Demanding reasoning'],['image','Image API','Creative generation'],['local','Device / private','Tools · available local models']].map(([id,name,sub],i)=>({id:'model:'+id,name,sub,x:990,y:115+i*110,color:'#6f9eb9',kind:'model',mark:''})),
 {id:'guard',name:'Response checks',sub:'Format · privacy · completion',x:1190,y:350,color:'#a8c8d8',kind:'guard',mark:'✓'},
 {id:'output',name:'Archindus',sub:'One coherent answer',x:1300,y:465,color:'#b8e7f6',kind:'output',mark:'A'}];}
export function engineNode(model?:string){if(!model)return undefined;const m=model.toLowerCase();return 'model:'+(m.includes('luna')?'luna':m.includes('terra')?'terra':m.includes('sol')?'sol':m.includes('astra')?'astra':/image|diffusion/.test(m)?'image':'local');}
export const preferredEngine=(id?:AgentId)=>'model:'+(id==='satoshi'?'sol':id==='ounumi'?'image':id==='architect'?'luna':'terra');
