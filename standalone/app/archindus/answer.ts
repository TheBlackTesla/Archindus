/** Only final answers may cross the worker/API boundary or enter saved history. */
export function finalAnswer(raw: string): string {
  const normalized = raw.replace(/\\(?=<\/?think>)/gi, "")
    .replace(/&lt;(\/?(?:think|analysis|reasoning))&gt;/gi, "<$1>");
  // Some templates supply the opening tag in the prompt, leaving only a closing
  // tag in the generated tokens. Buffering until completion handles that case.
  const firstOpen = normalized.search(/<(?:think|analysis|reasoning)>/i);
  const firstClose = normalized.search(/<\/(?:think|analysis|reasoning)>/i);
  const text = firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen)
    ? normalized.slice(normalized.indexOf(">", firstClose) + 1) : normalized;
  return text.replace(/<(think|analysis|reasoning)>[\s\S]*?(?:<\/\1>|$)/gi, "")
    .replace(/<\/?(?:thi(?:n(?:k)?)?|analys(?:i(?:s)?)?|reason(?:i(?:n(?:g)?)?)?)\s*$/i, "")
    .replace(/<\|(?:im_start|im_end|endoftext)\|>/g, "").trim();
}

export function isCapabilityDenial(text: string): boolean {
  return /(?:don.t|do not|cannot|can.t|unable to).{0,45}(?:ability to (?:write|produce|generate) code|(?:write|produce|generate) (?:any )?code)/i.test(text)
    || /(?:text.based|text.only).{0,100}(?:cannot|can.t|don.t have the ability)/i.test(text);
}

/** A completed raw-code reply is valid when the user asks for "only code".
 * Normalize its presentation for downloads; never repair unclosed fences or
 * treat this formatting step as proof that the code executes.
 */
export function formatAnswer(raw:string,task:string):string {
 const text=finalAnswer(raw);
 if(task!=='code'||text.includes('```')||isCapabilityDenial(text))return text;
 const head=text.replace(/^(?:(?:#[^\n]*|\/\/[^\n]*)\n|\s)+/,'');
 let language='';
 if(/^(?:from\s+[\w.]+\s+import|import\s+[\w.]+\s*(?:\n|$)|(?:async\s+)?def\s+\w+\s*\(|class\s+\w+[^\n]*:)/.test(head))language='python';
 else if(/^<!doctype\s+html|^<html\b/i.test(text))language='html';
 else if(/^(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function\b|(?:const|let|var)\s+\w+\s*=|class\s+\w+)|^import\s.+from\s/.test(head))language='javascript';
 else if(/^#include\s*[<"]|^(?:int|void|double|float|char)\s+\w+\s*\(/.test(text))language='cpp';
 else if(/^package\s+\w+/.test(head))language='go';
 else if(/^(?:pub\s+)?fn\s+\w+|^use\s+std::/.test(head))language='rust';
 else if(/^public\s+(?:final\s+)?class\s+\w+/.test(head))language='java';
 else if(/^(?:SELECT|WITH|CREATE\s+TABLE|INSERT\s+INTO)\b/i.test(head))language='sql';
 return language?`\`\`\`${language}\n${text}\n\`\`\``:text;
}

export function validateAnswer(text: string, task: string): string | null {
  if (!text.trim()) return "The model did not produce a final answer.";
  if (task === "code") {
    if (isCapabilityDenial(text)) return "The model failed to produce the requested code.";
    const fences = text.match(/^\s*```/gm) ?? [];
    if (fences.length < 2 || fences.length % 2) return "The code is incomplete. Try a smaller request or a stronger model.";
    const html = /```(?:html)?[^\n]*\n([\s\S]*?)```/i.exec(text)?.[1];
    if (html && /<!doctype html|<html\b/i.test(html) && !/<\/html\s*>/i.test(html)) return "The HTML document is incomplete. Please retry a smaller task.";
  }
  return null;
}

export type ContextMessage = { role: "user" | "assistant"; content: string; agentId?: string; status?: string; objective?: string; task?: string };
export function withoutToolTurns(history: ContextMessage[]) {
  let local=false;
  return history.filter(m=>{if(m.role==="user")local=/^\/(?:route|json)(?:\s|$)/i.test(m.content.trim());return !local;});
}
export function cleanHistory(history: ContextMessage[]): ContextMessage[] {
  const clean: ContextMessage[] = [];
  for (const message of withoutToolTurns(history)) {
    const content = message.role === "assistant" ? finalAnswer(message.content) : message.content;
    const invalid = (message.status && message.status !== "complete") || !content.trim()
      || (message.role === "assistant" && isCapabilityDenial(content));
    if (invalid) {
      // A failed task is not conversation context. Drop its matching request too;
      // otherwise a new poem can inherit the subject of an unsuccessful image.
      if (message.role === "assistant" && clean.at(-1)?.role === "user") clean.pop();
      continue;
    }
    clean.push({ ...message, content });
  }
  return clean;
}

/** Keep complete turns and the opening brief within each runtime's input budget. */
export function modelContext(history: ContextMessage[], objective: string, budget = 6500) {
  type Message = { role: "user" | "assistant"; content: string };
  const latest = objective.slice(0, budget);
  let remaining = Math.max(0, budget - latest.length);
  const turns: Message[][] = [];
  for (const message of cleanHistory(history)) {
    if (message.role === "user") {
      if (turns.at(-1)?.length === 1) turns.at(-1)![0].content += `\n${message.content}`;
      else turns.push([{ role: "user", content: message.content }]);
    } else if (turns.at(-1)?.length === 1) turns.at(-1)!.push({ role: "assistant", content: message.content });
  }
  // Pending, failed, and orphan messages cannot become completed conversation turns.
  const complete = turns.filter(turn => turn.length === 2);
  const size = (turn: Message[]) => turn.reduce((sum, message) => sum + message.content.length, 0);
  const truncate = (turn: Message[], allowance: number): Message[] => {
    const user = turn[0].content.slice(0, Math.min(turn[0].content.length, Math.floor(allowance / 2)));
    const room = allowance - user.length;
    const answer = turn[1].content;
    const content = answer.length <= room ? answer : room > 50
      ? `${answer.slice(0, Math.floor((room - 20) / 2))}\n[excerpt]\n${answer.slice(-Math.floor((room - 20) / 2))}`
      : answer.slice(0, room);
    return [{ role: "user", content: user }, { role: "assistant", content }];
  };
  // Keep the opening request paired with its real answer, never as a new system
  // instruction or an extra consecutive user message (which breaks WebLLM).
  const needsTrim = complete.length > 19 || complete.reduce((sum, turn) => sum + size(turn), 0) > remaining;
  const opening = needsTrim && complete.length > 2 && remaining > 600
    ? truncate(complete[0], Math.min(1000, Math.floor(remaining / 4))) : [];
  remaining -= size(opening);
  const recent: Message[][] = [];
  for (let i = complete.length - 1; i >= (opening.length ? 1 : 0) && recent.length < (opening.length ? 18 : 19); i--) {
    const turn = complete[i];
    if (size(turn) > remaining) {
      if (!recent.length && remaining > 100) recent.unshift(truncate(turn, remaining));
      break;
    }
    recent.unshift(turn); remaining -= size(turn);
  }
  return [...opening, ...recent.flat(), { role: "user" as const, content: latest }];
}

/** Send only bounded conversation text; omit UI metadata, media URLs, and file IDs. */
export function transportHistory(history: ContextMessage[]) {
  return modelContext(history.map(message => ({ ...message, content: message.content.slice(0, 16_000) })), "", 24_000).slice(0, -1);
}
