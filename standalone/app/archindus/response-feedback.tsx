'use client';
import {useState} from 'react';
import {accountRequest} from './account-settings';
export function ResponseFeedback({conversationId,messageId,save}:{conversationId:string;messageId:string;save:()=>Promise<void>}){
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const submit=async(rating?:number,prefer?:boolean)=>{
  setBusy(true);try{await save();await accountRequest('/feedback','POST',{conversationId,messageId,...(prefer?{prefer:true}:{rating})});setNotice(prefer?'Model preference saved.':'Rating saved. Your future routing will take it into account.')}catch(e){setNotice(e instanceof Error?e.message:'Please retry.')}finally{setBusy(false)}
 };
 return <div className="oracle-answer-actions" aria-label="Response feedback">
 <button type="button" disabled={busy} onClick={()=>void submit(1)}>Helpful</button>
 <button type="button" disabled={busy} onClick={()=>void submit(-1)}>Needs improvement</button>
 <button type="button" disabled={busy} onClick={()=>void submit(undefined,true)}>Prefer this model</button>
 {notice?<span role="status">{notice}</span>:null}</div>;
}
export function FeedbackSettings(){
 const [notice,setNotice]=useState('');
 return <section><h3>Adaptive routing</h3><p>Your response ratings and preferred model influence your own routing alongside task suitability, cost, Arena evidence and Hugging Face availability. Free models retain priority. Temporary chats exclude your saved ratings.</p><button type="button" onClick={()=>{void accountRequest('/feedback','DELETE',{}).then(()=>setNotice('Ratings and model preference cleared.')).catch(()=>setNotice('Could not clear feedback. Please retry.'))}}>Clear ratings and model preference</button><p role="status">{notice}</p></section>;
}
