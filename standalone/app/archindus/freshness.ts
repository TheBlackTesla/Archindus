export const currentPresidentQuestion=(text:string)=>/^(?:please\s+)?(?:who\s+is|who['’]s|name|tell me|what is the name of)\s+(?:the\s+)?(?:current\s+|sitting\s+)?(?:(?:u\.?s\.?|united states|american)\s+)?president(?:\s+of\s+(?:the\s+)?(?:united states(?: of america)?|u\.?s\.?|america))?(?:\s+(?:right now|now|today))?[?.!\s]*$/i.test(text.trim());

/** Route changing facts and explicit research requests through retrieval. */
export function needsLiveSearch(text:string,history:readonly {role:string;content:string}[]=[]){
 if(currentPresidentQuestion(text))return true;
 const previous=[...history].reverse().find(m=>m.role==='user')?.content;
 if(previous&&/^(?:and\b|what about\b|how about\b|tell me more|sources?\b)/i.test(text.trim())&&needsLiveSearch(previous))return true;
 const q=text.replace(/```[\s\S]*?```/g,'').trim();
 if(/^(?:write|create|draft|translate|rephrase|shorten|summarize|format)\b/i.test(q)&&! /\b(latest|current|news|today|research|search|look up|verify)\b/i.test(q))return false;
 if(/^\/search\b|\bsearch for\b|\bfind (?:current )?sources\b|\bwho won\b|\bwhat happened\b/i.test(q))return true;
 return /\b(current|latest|today|tonight|now|recent(?:ly)?|this (?:week|month|year)|breaking news|up.to.date|live (?:price|score|results)|news|weather|forecast|stock price|exchange rate)\b/i.test(q)
 || /\b(search (?:the )?(?:web|internet)|look up|browse|fact.check|verify|research)\b/i.test(q)
 || /\bwho (?:is|['’]s)\b.*\b(president|prime minister|ceo|governor|mayor|leader)\b/i.test(q)
 || /\b(?:price|cost|availability|schedule|standings|election results|release date)\b.*\b(?:of|for)\b/i.test(q)
 || /\b(?:dosage|drug interaction|medical guideline|tax law|legal requirement|regulation|visa requirement|software release|api documentation)\b/i.test(q)
 || /\b(?:recommend|best)\b.*\b(?:model|laptop|phone|restaurant|hotel|software|api|tool)\b/i.test(q);
}
