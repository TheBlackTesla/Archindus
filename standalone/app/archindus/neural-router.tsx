'use client';
import {useEffect,useRef,type RefObject,type ReactNode} from 'react';
import {nearestGraph,type Point} from './neural-topology';
import {neuralLinks,projectNeuron,type NeuralEntity} from './living-brain';
type Props={expanded:boolean;nodes:NeuralEntity[];path:string[];running:boolean;selected?:string;onInspect:(id:string)=>void;onExpand:()=>void;zoom:number;reset:number;activity:RefObject<number>;children?:ReactNode};
export function NeuralRouter(p:Props){
 const field=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),buttons=useRef(new Map<string,HTMLButtonElement>()),latest=useRef(p),camera=useRef({yaw:-.08,pitch:-.08}),drag=useRef<{x:number;y:number;yaw:number;pitch:number}|null>(null),hover=useRef<string|undefined>(undefined),pointer=useRef({x:0,y:0});
 useEffect(()=>{latest.current=p},[p]);
 useEffect(()=>{camera.current={yaw:-.08,pitch:-.08}},[p.reset]);
 useEffect(()=>{
  const el=field.current,c=canvas.current,ctx=c?.getContext('2d');if(!el||!c||!ctx)return;
  let width=800,height=600,frame=0,last=0,expansion=0,previousActivity=0,energy=0;
  // Restore the original dense neural surface as visual texture. Semantic
  // buttons above it remain the actual model/personality nodes; only real
  // request events illuminate the surface, never invented background work.
  let seed=21731;const random=()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646};
  const count=window.innerWidth<640?300:540;
  const mesh:Point[]=Array.from({length:count},(_,i)=>{const y=1-2*((i+.5)/count),angle=i*Math.PI*(3-Math.sqrt(5)),ring=Math.sqrt(1-y*y),radius=.63+random()*.37;return {x:Math.cos(angle)*ring*radius*(1+.07*Math.sin(angle*3+y*5)),y:y*radius,z:Math.sin(angle)*ring*radius,size:.5+random()*1.15}});
  const topology=nearestGraph(mesh),charge=new Float32Array(count);let previousPath='';
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const resize=()=>{const rect=el.getBoundingClientRect();width=rect.width;height=rect.height;const dpr=Math.min(window.devicePixelRatio||1,1.5);c.width=Math.round(width*dpr);c.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)};
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  const draw=(now:number)=>{
   frame=requestAnimationFrame(draw);if(document.hidden||now-last<(motion.matches?200:1000/30))return;const dt=Math.min(.08,(now-last)/1000);last=now;const s=latest.current;
   expansion+=((s.expanded?1:0)-expansion)*(motion.matches?1:Math.min(1,dt*6));
   if(!motion.matches&&!drag.current&&!hover.current&&!s.selected)camera.current.yaw+=dt*(s.expanded?.018:.045);
   if(s.activity.current!==previousActivity){energy=1;previousActivity=s.activity.current}energy*=Math.exp(-dt*2);
   const yaw=camera.current.yaw+(motion.matches?0:pointer.current.x*.035),pitch=camera.current.pitch+(motion.matches?0:pointer.current.y*.025);
   const projected=new Map(s.nodes.map(n=>[n.id,projectNeuron(n.position,yaw,pitch,width,height,s.zoom,expansion)]));
   ctx.clearRect(0,0,width,height);
   const radius=Math.min(width,height)*.45;const aura=ctx.createRadialGradient(width/2,height/2,0,width/2,height/2,radius);
   aura.addColorStop(0,`rgba(77,158,199,${.055+(s.running?energy*.035:0)})`);aura.addColorStop(.65,'rgba(42,108,146,.023)');aura.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=aura;ctx.fillRect(0,0,width,height);
   const signature=s.path.join('>');
   if((energy>.9||signature!==previousPath)&&s.path.length){
    for(const id of s.path){const entity=s.nodes.find(n=>n.id===id);if(!entity)continue;let nearest=0,distance=Infinity;for(let i=0;i<mesh.length;i++){const q=mesh[i],d=Math.hypot(q.x-entity.position.x,q.y-entity.position.y,q.z-entity.position.z);if(d<distance){nearest=i;distance=d}}charge[nearest]=1;for(const i of topology.neighbors[nearest])charge[i]=Math.max(charge[i],.55)}
   }previousPath=signature;
   const surface=mesh.map((n,i)=>{charge[i]*=Math.exp(-dt*2.5);return {...projectNeuron(n,yaw,pitch,width,height,s.zoom,expansion),size:n.size,light:motion.matches?0:charge[i]}});
   for(const [a,b] of topology.edges){const u=surface[a],v=surface[b],front=Math.max(.05,((u.depth+v.depth)/2+1)/2),light=Math.min(u.light,v.light);ctx.strokeStyle=`rgba(${light>.2?'144,222,255':'136,180,204'},${.07+front*.26+light*.48})`;ctx.lineWidth=.65+light*.75;ctx.beginPath();ctx.moveTo(u.x,u.y);ctx.lineTo(v.x,v.y);ctx.stroke()}
   for(const at of surface){const front=Math.max(.1,(at.depth+1.1)/2.2),light=at.light;if(light>.15){const halo=ctx.createRadialGradient(at.x,at.y,0,at.x,at.y,8+light*5);halo.addColorStop(0,`rgba(114,209,255,${light*front*.55})`);halo.addColorStop(1,'rgba(100,200,255,0)');ctx.fillStyle=halo;ctx.beginPath();ctx.arc(at.x,at.y,8+light*5,0,Math.PI*2);ctx.fill()}ctx.fillStyle=`rgba(${light>.3?'224,249,255':'166,208,230'},${Math.min(1,.15+front*.7+light*.5)})`;ctx.beginPath();ctx.arc(at.x,at.y,Math.max(.4,at.size*at.scale*(.5+front*.65)+light*.85),0,Math.PI*2);ctx.fill()}
   const links=neuralLinks(s.nodes,s.path),active=new Set(s.path.slice(1).map((id,i)=>s.path[i]+'>'+id));
   for(const [a,b] of links){const u=projected.get(a)!,v=projected.get(b)!,lit=active.has(a+'>'+b)||active.has(b+'>'+a),related=hover.current===a||hover.current===b||s.selected===a||s.selected===b;
    const depth=Math.max(.1,((u.depth+v.depth)/2+1.1)/2.2);ctx.strokeStyle=lit?`rgba(164,229,255,${.7+energy*.25})`:related?'rgba(130,196,220,.3)':`rgba(103,162,193,${.07+depth*.25})`;ctx.lineWidth=lit?1.45:related?.8:.5;
    const bend=(v.x-u.x)*.035;ctx.beginPath();ctx.moveTo(u.x,u.y);ctx.quadraticCurveTo((u.x+v.x)/2+bend,(u.y+v.y)/2-14,v.x,v.y);ctx.stroke();
    if(lit&&s.running&&!motion.matches){const t=(now*.0004)%1,x=(1-t)*(1-t)*u.x+2*(1-t)*t*((u.x+v.x)/2+bend)+t*t*v.x,y=(1-t)*(1-t)*u.y+2*(1-t)*t*((u.y+v.y)/2-14)+t*t*v.y;ctx.fillStyle='#d8f6ff';ctx.shadowBlur=10;ctx.shadowColor='#8edcff';ctx.beginPath();ctx.arc(x,y,2.1,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
   }
   // Vacant slots stay visibly attached to the volume, but never transmit.
   for(const n of s.nodes.filter(n=>n.kind==='empty')){const a=projected.get(n.id)!,b=projected.get('router')!;ctx.setLineDash([1,9]);ctx.strokeStyle='rgba(110,157,182,.07)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);}
   for(const n of s.nodes){const at=projected.get(n.id)!,button=buttons.current.get(n.id);if(!button)continue;button.style.transform=`translate(${at.x}px,${at.y}px) translate(-50%,-50%) scale(${at.scale})`;button.style.opacity=String(s.selected===n.id||hover.current===n.id||s.path.includes(n.id)?1:at.opacity);button.style.zIndex=String(10+Math.round(at.depth*5));}
   const anchor=s.selected?projected.get(s.selected):undefined;
   if(anchor){const cardWidth=Math.min(300,width-32),left=anchor.x>width*.5?anchor.x+30:anchor.x-cardWidth-30;el.style.setProperty('--inspect-left',Math.max(16,Math.min(width-cardWidth-16,left))+'px');el.style.setProperty('--inspect-top',Math.max(80,Math.min(170,anchor.y-100))+'px');}
  };
  frame=requestAnimationFrame(draw);return()=>{cancelAnimationFrame(frame);observer.disconnect()};
 },[]);
 return <div className="neural-volume" ref={field} data-expanded={p.expanded} data-running={p.running} role="region" aria-label="Interactive Archindus brain. Drag to rotate; use the zoom controls to explore."
  onPointerDown={e=>{if(!p.expanded||(e.target as Element).closest('button,select,input,textarea,a,.neuron-inspector'))return;drag.current={x:e.clientX,y:e.clientY,...camera.current};e.currentTarget.setPointerCapture(e.pointerId)}}
  onPointerMove={e=>{const rect=e.currentTarget.getBoundingClientRect();pointer.current={x:(e.clientX-rect.left)/rect.width-.5,y:(e.clientY-rect.top)/rect.height-.5};if(drag.current){camera.current.yaw=drag.current.yaw+(e.clientX-drag.current.x)*.006;camera.current.pitch=Math.max(-1,Math.min(1,drag.current.pitch+(e.clientY-drag.current.y)*.004))}}}
  onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onPointerLeave={()=>{pointer.current={x:0,y:0}}}>
  <canvas ref={canvas} aria-hidden="true" className="neural-volume-canvas"/>
  <div className="neural-entity-layer" aria-hidden={!p.expanded}>{p.nodes.map(n=><button key={n.id} type="button" ref={el=>{if(el)buttons.current.set(n.id,el);else buttons.current.delete(n.id)}} className={`neuron ${n.kind} ${p.path.includes(n.id)?'engaged':''} ${p.selected===n.id?'selected':''}`} style={{'--neuron-color':n.color} as React.CSSProperties} tabIndex={p.expanded?0:-1} aria-label={n.kind==='empty'?'Create personality in empty node '+(Number(n.id.split(':')[1])+1):'Inspect '+n.name} aria-pressed={p.selected===n.id} onClick={()=>p.onInspect(n.id)} onMouseEnter={()=>{hover.current=n.id}} onMouseLeave={()=>{hover.current=undefined}} onFocus={()=>{hover.current=n.id}} onBlur={()=>{hover.current=undefined}}><span className="neuron-core">{n.mark}</span><span className="neuron-label">{n.name}<small>{n.kind==='empty'?'Empty node':n.kind==='model'?'MODEL':n.kind==='router'?'ROUTER':n.personality?'YOUR PERSONALITY':'PERSONALITY'}</small></span></button>)}</div>
  {!p.expanded?<button type="button" className="neural-expand-target" aria-label="Expand Archindus brain" aria-expanded={false} aria-controls="archindus-neural-brain" onClick={p.onExpand}><span>Explore the neural system <span aria-hidden="true">↗</span></span></button>:null}
  {p.children}
 </div>;
}
