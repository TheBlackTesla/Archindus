import type { TaskPlan } from '../../app/archindus/orchestration';

export type ModelPolicy = 'auto' | 'economy' | 'quality';
export type TextModel = { id: string; name: string; input: number; cached:number; output: number; reasoning: 'none' | 'low' | 'high'; tier: string };
// Standard API prices, USD per million tokens, verified 2026-11-06.
// Numerically these are also microdollars per token. No arbitrary client model IDs.
export const MODEL_CATALOG: TextModel[] = [
 { id:'gpt-6-luna',name:'GPT-6 Luna',input:.1,cached:.01,output:.5,reasoning:'none',tier:'Economical' },
 { id:'gpt-6.1-terra',name:'GPT-6.1 Terra',input:1,cached:.05,output:5,reasoning:'none',tier:'Balanced' },
 { id:'gpt-6.1-sol',name:'GPT-6.1 Sol',input:2,cached:.1,output:10,reasoning:'low',tier:'Coding' },
 { id:'gpt-6-astra',name:'GPT-6 Astra',input:10,cached:1,output:50,reasoning:'high',tier:'Deep reasoning' },
];
export function selectTextModel(objective: string, plan: Pick<TaskPlan,'task'|'primaryId'>, policy: ModelPolicy='auto', planning=false): TextModel {
 if(planning || policy==='economy')return MODEL_CATALOG[0];
 if(policy==='quality' || /\b(deep research|rigorous proof|prove.*theorem|most (?:capable|powerful)|highest quality|complex (?:reasoning|architecture)|use (?:astra|the best model))\b/i.test(objective))return MODEL_CATALOG[3];
 if(plan.task==='code' || plan.primaryId==='satoshi')return MODEL_CATALOG[2];
 if(['analysis','document'].includes(plan.task) || ['socrates','wolf','datadoc','ounumi'].includes(plan.primaryId) || objective.length>1200)return MODEL_CATALOG[1];
 return MODEL_CATALOG[0];
}
export function textCost(inputTokens:number,outputTokens:number,model:Pick<TextModel,'input'|'output'>){
 // Includes an upper bound on automatic cache writes (1.25x input).
 return Math.ceil(inputTokens*model.input*1.25+outputTokens*model.output);
}
export function textUsageCost(usage:{prompt_tokens:number;completion_tokens:number;prompt_tokens_details?:{cached_tokens?:number;cache_write_tokens?:number}},model:Pick<TextModel,'input'|'output'> & {cached?:number}){
 const details=usage.prompt_tokens_details;
 if(!details||!Number.isSafeInteger(details.cached_tokens)||!Number.isSafeInteger(details.cache_write_tokens))return textCost(usage.prompt_tokens,usage.completion_tokens,model);
 const cached=Math.max(0,Math.min(usage.prompt_tokens,details.cached_tokens!));
 const writes=Math.max(0,Math.min(usage.prompt_tokens-cached,details.cache_write_tokens!));
 return Math.ceil((usage.prompt_tokens-cached)*model.input+cached*(model.cached??model.input)+writes*model.input*.25+usage.completion_tokens*model.output);
}
