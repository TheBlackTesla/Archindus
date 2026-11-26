/** Fixed public synthetic tasks. No user prompts or memories enter this suite. */
export const SUITE_VERSION='synthetic-quality-v1';
export const GRADER_VERSION='deterministic-v1';
type Example={args:number[];answer:number};
export type QualityCase={id:string;split:'development'|'holdout';task:'chat'|'analysis'|'code';prompt:string;expected?:unknown;functionName?:string;parameters?:string[];examples?:Example[]};
export const QUALITY_CASES:QualityCase[]=[
 {id:'extract-person',split:'development',task:'analysis',prompt:'Ada Lovelace has 3 notebooks. Return only JSON with exactly name (string) and notebooks (number).',expected:{name:'Ada Lovelace',notebooks:3}},
 {id:'extract-stock',split:'development',task:'analysis',prompt:'Warehouse B contains 17 blue boxes. Return only JSON with exactly warehouse (string), color (string), boxes (number).',expected:{warehouse:'B',color:'blue',boxes:17}},
 {id:'sort-names',split:'development',task:'chat',prompt:'Sort these names alphabetically: Zoe, Ada, Lin. Return only JSON with exactly names, an array of strings.',expected:{names:['Ada','Lin','Zoe']}},
 {id:'even-values',split:'development',task:'analysis',prompt:'From [7,2,9,4,8,3], select even numbers, retaining input order. Return only JSON with exactly even, an array of numbers.',expected:{even:[2,4,8]}},
 {id:'pens',split:'development',task:'analysis',prompt:'There are 7 boxes of 8 pens. Nine pens are given away. Return only JSON with exactly answer, the number remaining.',expected:{answer:47}},
 {id:'inventory',split:'development',task:'analysis',prompt:'There are 7 trays of 12 cups. Remove 18 cups. Return only JSON with exactly answer, the number remaining.',expected:{answer:66}},
 {id:'reverse-tokens',split:'development',task:'chat',prompt:'Reverse the order of these tokens, without changing spelling: red, blue, green. Return only JSON with exactly tokens, an array of strings.',expected:{tokens:['green','blue','red']}},
 {id:'linear-function',split:'development',task:'code',prompt:'Return only JSON with exactly code, a string containing a JavaScript function named linear(n) that returns three times n plus two. Use a single return expression and no other statements.',functionName:'linear',parameters:['n'],examples:[{args:[-4],answer:-10},{args:[0],answer:2},{args:[7],answer:23}]},
 {id:'square-function',split:'holdout',task:'code',prompt:'Return only JSON with exactly code, a string containing a JavaScript function named square(n) that returns the square of n. Use a single return expression and no other statements.',functionName:'square',parameters:['n'],examples:[{args:[-4],answer:16},{args:[0],answer:0},{args:[5],answer:25},{args:[12],answer:144}]},
 {id:'add-function',split:'holdout',task:'code',prompt:'Return only JSON with exactly code, a string containing a JavaScript function named add(a,b) that returns their sum. Use a single return expression and no other statements.',functionName:'add',parameters:['a','b'],examples:[{args:[-2,5],answer:3},{args:[0,0],answer:0},{args:[8,7],answer:15}]},
 {id:'books',split:'holdout',task:'analysis',prompt:'Three shelves contain six books each. Four books are removed, then nine are added. Return only JSON with exactly answer, the final number of books.',expected:{answer:23}},
 {id:'instruction-case',split:'holdout',task:'chat',prompt:'Convert these tokens to uppercase, reverse their order, and retain punctuation: alpha!, beta?. Return only JSON with exactly tokens, an array of strings.',expected:{tokens:['BETA?','ALPHA!']}},
];
for(const item of QUALITY_CASES)if(item.functionName)item.prompt+=' Use only numeric literals, the named parameters, parentheses and arithmetic operators (+, -, *, /, %, **). No calls, properties or comments.';
function stable(value:any):string{return Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value)}
/** Interpret a small arithmetic AST as data. Never eval or execute model code. */
export function arithmeticExpression(source:string,scope:Record<string,number>){
 if(/\+\+|--|(^|[+\-*/%(])\s*[-+]\s*(?:[A-Za-z_]\w*|\d+(?:\.\d+)?)\s*\*\*/.test(source))throw Error('Unsupported unary syntax');
 const tokens:string[]=[];let offset=0;
 while(offset<source.length){const match=/^\s*(\*\*|[()+\-*/%]|[A-Za-z_]\w*|\d+(?:\.\d+)?)/.exec(source.slice(offset));if(!match){if(source.slice(offset).trim())throw Error('Unsupported syntax');break}tokens.push(match[1]);offset+=match[0].length;if(tokens.length>100)throw Error('Expression too large')}
 let cursor=0,depth=0;
 const expression=(minimum=0):number=>{
  if(++depth>100)throw Error('Expression too deep');let value:number;const token=tokens[cursor++];
  if(token==='('){value=expression();if(tokens[cursor++]!==')')throw Error('Parenthesis')}
  else if(token==='-'||token==='+')value=(token==='-'?-1:1)*expression(4);
  else if(token&&/^\d/.test(token))value=Number(token);
  else if(token&&Object.hasOwn(scope,token))value=scope[token];else throw Error('Unsupported identifier');
  const precedences:Record<string,number>={'+':1,'-':1,'*':2,'/':2,'%':2,'**':3};
  while(cursor<tokens.length){const op=tokens[cursor],precedence=precedences[op];if(!precedence||precedence<minimum)break;cursor++;const right=expression(op==='**'?precedence:precedence+1);value=op==='+'?value+right:op==='-'?value-right:op==='*'?value*right:op==='/'?value/right:op==='%'?value%right:value**right;}
  depth--;if(!Number.isFinite(value))throw Error('Nonfinite result');return value;
 };
 const result=expression();if(cursor!==tokens.length)throw Error('Trailing syntax');return result;
}
export function gradeQuality(item:QualityCase,text:string){
 try{
  if(text.length>8000)throw Error('Output too large');const clean=text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1');const value=JSON.parse(clean);
  if(item.functionName){
   if(!value||typeof value.code!=='string'||Object.keys(value).join()!=='code')return {passed:false,reason:'code_shape'};
   const match=/^\s*function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{\s*return\s+([^;{}]+);?\s*\}\s*$/.exec(value.code);
   if(!match||match[1]!==item.functionName)return {passed:false,reason:'unsupported_function_shape'};
   const names=match[2].split(',').map(n=>n.trim());if(names.some(n=>! /^[A-Za-z_]\w*$/.test(n))||new Set(names).size!==names.length||stable(names)!==stable(item.parameters))return {passed:false,reason:'parameters'};
   for(const example of item.examples!){if(names.length!==example.args.length||arithmeticExpression(match[3],Object.fromEntries(names.map((n,i)=>[n,example.args[i]])))!==example.answer)return {passed:false,reason:'function_result'}}
   return {passed:true,reason:'function_cases_passed'};
  }
  return stable(value)===stable(item.expected)?{passed:true,reason:'exact_match'}:{passed:false,reason:'wrong_value_or_shape'};
 }catch{return {passed:false,reason:'invalid_or_unsupported_output'}}
}
export type QualityObservation={caseId:string;arm:'champion'|'challenger'|'shared';status:'complete'|'unavailable';passed:boolean;reason:string;model:string;elapsedMs:number;chargedMicrodollars:number;outputHash?:string};
export function summarizeQuality(observations:QualityObservation[]){
 const keys=new Set<string>();for(const row of observations){const key=row.caseId+':'+row.arm;if(keys.has(key)||!QUALITY_CASES.some(c=>c.id===row.caseId)||!['champion','challenger','shared'].includes(row.arm)||!['complete','unavailable'].includes(row.status)||typeof row.passed!=='boolean'||!Number.isFinite(row.elapsedMs)||row.elapsedMs<0||!Number.isSafeInteger(row.chargedMicrodollars)||row.chargedMicrodollars<0)throw Error('Invalid or duplicate quality observations');keys.add(key);}
 const pairs=QUALITY_CASES.map(item=>({item,champion:observations.find(r=>r.caseId===item.id&&(r.arm==='champion'||r.arm==='shared')),challenger:observations.find(r=>r.caseId===item.id&&(r.arm==='challenger'||r.arm==='shared'))}));
 const matched=pairs.filter(p=>p.champion?.status==='complete'&&p.challenger?.status==='complete');
 const holdout=matched.filter(p=>p.item.split==='holdout');
 const score=(rows:typeof matched,arm:'champion'|'challenger')=>rows.length?rows.filter(p=>p[arm]!.passed).length/rows.length:null;
 const differences=holdout.map(p=>Number(p.challenger!.passed)-Number(p.champion!.passed));const difference=differences.length?differences.reduce((a,b)=>a+b,0)/differences.length:null;
 const total=(arm:'champion'|'challenger',field:'elapsedMs'|'chargedMicrodollars')=>matched.reduce((n,p)=>n+p[arm]![field],0);
 const ratio=(a:number,b:number)=>b?a/b:a===0?1:null;
 return {suiteVersion:SUITE_VERSION,graderVersion:GRADER_VERSION,distinctCases:QUALITY_CASES.length,completedPairs:pairs.filter(p=>p.champion&&p.challenger).length,championAvailability:pairs.filter(p=>p.champion?.status==='complete').length/QUALITY_CASES.length,challengerAvailability:pairs.filter(p=>p.challenger?.status==='complete').length/QUALITY_CASES.length,matchedCases:matched.length,holdoutSamples:holdout.length,championPassRate:score(matched,'champion'),challengerPassRate:score(matched,'challenger'),holdoutDifference:difference,qualityLowerBound:difference===null?null:difference-Math.sqrt(2*Math.log(20)/holdout.length),costRatio:ratio(total('challenger','chargedMicrodollars'),total('champion','chargedMicrodollars')),latencyRatio:ratio(total('challenger','elapsedMs'),total('champion','elapsedMs')),unavailable:observations.filter(r=>r.status==='unavailable').length,sharedCases:observations.filter(r=>r.arm==='shared').length,evidence:'Fixed synthetic benchmark only; not a representative production causal estimate'};
}
