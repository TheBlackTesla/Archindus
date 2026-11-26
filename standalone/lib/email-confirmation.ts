/** Only fixed destinations and Supabase email-verification types are accepted. */
export const PENDING_EMAIL_COOKIE='archindus-email-confirmation';
export const confirmationType=(value:string|null)=>value==='email'||value==='signup'?'email':value==='recovery'?'recovery':null;
export const validConfirmationToken=(value:string|null):value is string=>!!value&&/^[A-Za-z0-9_-]{20,2048}$/.test(value);
export function confirmationNotice(error:string){
 if(error==='expired')return 'This confirmation link has expired or was already used. Try signing in first; if your email is still unconfirmed, request a new confirmation email below.';
 if(error==='browser')return 'The signup session is missing or has changed. Your email may already be confirmed—try signing in first, or request a new confirmation email below.';
 if(error==='service')return 'The account service could not complete confirmation. Please try again shortly.';
 return 'This confirmation link is incomplete or invalid. Request a new confirmation email below.';
}
