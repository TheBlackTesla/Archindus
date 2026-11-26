/** Saved history is independent of the bounded text sent to each model. */
export const MAX_CONVERSATION_MESSAGES=500;
export const MAX_CONVERSATION_BYTES=1_500_000;
export function checkConversationPayload(messages:unknown[]){
 if(messages.length>MAX_CONVERSATION_MESSAGES)throw new Error('This conversation has reached 500 saved messages. Start a new chat to continue; your saved history is retained.');
 if(new TextEncoder().encode(JSON.stringify({messages})).byteLength>MAX_CONVERSATION_BYTES)throw new Error('This conversation is too large to save (1.5 MB). Start a new chat. Your previous saved history is retained.');
}
