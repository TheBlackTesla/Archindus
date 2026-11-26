'use client';
import {useEffect,useState} from 'react';
import '../workspace/workspace.css';
type Check={model:string;agent:string;outcome:string;actual?:string;checkedAt?:number;lastPassedAt?:number;ranToday:boolean};
export default function Checks(){
 const [checks,setChecks]=useState<Check[]>([]),[armed,setArmed]=useState(false),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 const refresh=async()=>{const r=await fetch('/api/archindus/checks',{cache:'no-store'});if(!r.ok)throw Error('Status is unavailable.');const d=await r.json();setChecks(d.checks);setArmed(d.armed)};
 useEffect(()=>{void refresh().catch(e=>setNotice(e.message))},[]);
 const run=async(c:Check)=>{setBusy(c.model);setNotice('');try{const r=await fetch('/api/archindus/checks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:c.model})});if(!r.ok)throw Error('The check was unavailable.');await refresh()}catch(e){setNotice(e instanceof Error?e.message:'Check was interrupted.')}finally{setBusy('')}};
 return <main className="source-work"><header><a href="/">Archindus</a><span>Model verification</span></header><div className="work-intro"><h1>Model verification</h1><p>Each release check uses a fixed task and the production model connection.</p></div>{checks.map(c=><article className="work-view" key={c.model}><h2>{c.model}</h2><p>{c.agent==='satoshi'?'Satoshi · JavaScript function with three test cases':c.agent==='socrates'?'Socrates · multi-step arithmetic with a known answer':'Ounumi · valid 1024 × 1024 PNG'}</p><p>Latest result · {c.outcome.replaceAll('_',' ')}{c.actual?' · '+c.actual:''}</p><p>Last passed · {c.lastPassedAt?new Date(c.lastPassedAt).toLocaleString():'No successful check recorded'}</p>{armed&&!c.ranToday&&<button disabled={!!busy} onClick={()=>void run(c)}>Run {c.agent} check</button>}</article>)}<p role="status">{busy?'Checking '+busy+'…':notice}</p></main>
}
