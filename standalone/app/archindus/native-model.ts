import {modelContext,type ContextMessage} from "./answer";
import {localPrompt} from "./local-model";
import type {TaskPlan} from "./orchestration";
import {AnswerStream} from "./stream";
type TextSpec={type:"text";languages:string[]};
type Options={expectedInputs:TextSpec[];expectedOutputs:TextSpec[]};
type Session={promptStreaming(text:string,o:{signal:AbortSignal}):ReadableStream<string>;destroy():void};
export type NativeModel={availability(o:Options):Promise<string>;create(o: Options & {signal:AbortSignal;initialPrompts:{role:string;content:string}[]}):Promise<Session>};
const spec:Options={expectedInputs:[{type:"text",languages:["en"]}],expectedOutputs:[{type:"text",languages:["en"]}]};
const getApi=()=>(globalThis as typeof globalThis & {LanguageModel?:NativeModel}).LanguageModel;
export async function nativeReady(api=getApi()) {
  try { return (await api?.availability(spec))==="available"; } catch {return false;}
}
export async function nativeAnswer(plan:TaskPlan,objective:string,history:ContextMessage[],signal:AbortSignal,onPartial?:(s:string)=>void,api=getApi()) {
  if (!api || !await nativeReady(api)) throw new Error("No installed browser AI is available.");
  signal.throwIfAborted();
  const turns=modelContext(history,objective,6000), question=turns.pop()!;
  const session=await api.create({...spec,signal,initialPrompts:[{role:"system",content:localPrompt(plan)},...turns]});
  try {
    signal.throwIfAborted();
    const reader=session.promptStreaming(question.content,{signal}).getReader(), answer=new AnswerStream();
    let last=0;
    try { while(true){signal.throwIfAborted();const part=await reader.read(); if(part.done)break;
      const text=answer.push(part.value);if(text && (!last || performance.now()-last>=50)){onPartial?.(text);last=performance.now();}
    }} finally {reader.releaseLock();}
    signal.throwIfAborted();return {text:answer.finish(),model:"Built-in browser AI"};
  } finally {session.destroy();}
}
