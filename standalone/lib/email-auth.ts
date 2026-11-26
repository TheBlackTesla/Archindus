import {createServerClient,parseCookieHeader,serializeCookieHeader} from '@supabase/ssr';
import type {SupabaseClient} from '@supabase/supabase-js';
import {setEmailIdentity} from './request-identity';
import {boundedAccountJson} from './account';
import {z} from 'zod';
import {PENDING_EMAIL_COOKIE,confirmationType,validConfirmationToken} from './email-confirmation';
export type AuthValues=Record<string,unknown>;
export function emailAuthConfig(values:AuthValues){const url=values.SUPABASE_URL,key=values.SUPABASE_PUBLISHABLE_KEY;if(typeof url!=='string'||typeof key!=='string'||!key)return null;try{const parsed=new URL(url);if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||parsed.username||parsed.password||parsed.pathname!=='/')return null;return {url:parsed.origin,key,signupEnabled:values.ARCHINDUS_EMAIL_SIGNUP_ENABLED==='true'}}catch{return null}}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function withEmailAuth(request:Request,values:AuthValues,handler:(client:SupabaseClient|null)=>Promise<Response>|Response,send:typeof fetch=fetch){
 const config=emailAuthConfig(values);if(!config)return handler(null);
 const pending=new Map<string,string>();const incoming=parseCookieHeader(request.headers.get('cookie')??'');
 const client=createServerClient(config.url,config.key,{cookieOptions:{name:'archindus-auth',path:'/',sameSite:'lax',httpOnly:true,secure:new URL(request.url).protocol==='https:'},global:{fetch:async(input,init)=>{
  // Workers support manual redirects. Never forward account credentials to a redirect target.
  const response=await send(input,{...init,redirect:'manual',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
  if(response.type==='opaqueredirect'||(response.status>=300&&response.status<400)){
   await response.body?.cancel();
   throw new Error('Unexpected redirect from the account service');
  }
  return response;
 }},cookies:{getAll:()=>incoming.map(c=>({name:c.name,value:c.value??''})),setAll:cookies=>{for(const cookie of cookies){pending.set(cookie.name,serializeCookieHeader(cookie.name,cookie.value,{...cookie.options,path:'/',httpOnly:true,sameSite:'lax',secure:new URL(request.url).protocol==='https:'}));const current=incoming.find(c=>c.name===cookie.name);if(current)current.value=cookie.value;else incoming.push(cookie)}}}});
 try{
  if(incoming.some(c=>/^archindus-auth(?:\.\d+)?$/.test(c.name))){
   setEmailIdentity(request,null);const {data,error}=await client.auth.getUser();
   if(!error&&data.user?.email_confirmed_at&&data.user.email)setEmailIdentity(request,{id:'email:'+new URL(config.url).hostname.split('.')[0]+':'+data.user.id,email:data.user.email,name:typeof data.user.user_metadata?.name==='string'?data.user.user_metadata.name.slice(0,120):'',provider:'email'});
  }
  const response=await handler(client),headers=new Headers(response.headers);for(const value of pending.values())headers.append('Set-Cookie',value);if(pending.size){headers.set('Cache-Control','no-store');headers.set('Vary','Cookie')}
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }catch{return json({error:'Account service is temporarily unavailable. Guest chat remains available.'},503)}
}
type AccountAction='signup'|'signin'|'recover';
function accountFailure(error:unknown,action:AccountAction){
 const value=error as {status?:number;code?:string;name?:string};
 const known=new Set(['over_email_send_rate_limit','over_request_rate_limit','email_address_not_authorized','email_address_invalid','weak_password','signup_disabled','email_provider_disabled','user_already_exists','email_exists','invalid_credentials','email_not_confirmed','unexpected_failure','request_timeout']);
 const code=known.has(value?.code??'')?value.code!:'unclassified';
 const status=Number.isInteger(value?.status)?value.status:0;
 // Never log provider messages, credentials, email addresses, cookies or response bodies.
 console.warn('email_auth_failure',{action,status,code});
 if(status===429||code==='over_email_send_rate_limit'||code==='over_request_rate_limit')return json({error:'Account requests are temporarily rate limited. Please wait a few minutes before trying again.',code:'account_rate_limited'},429);
 if(code==='email_address_not_authorized')return json({error:'Verification email delivery is not ready for public signup. Please try again later. Guest chat remains available.',code:'email_delivery_unavailable'},503);
 if(action==='signup'&&code==='weak_password')return json({error:'Use a stronger password with at least 12 characters, upper and lowercase letters, numbers and a symbol.',code:'weak_password'},400);
 if(action==='signup'&&code==='email_address_invalid')return json({error:'Enter a valid email address.',code:'invalid_email'},400);
 if(action==='signup'&&(code==='user_already_exists'||code==='email_exists'))return json({error:'Unable to create this account. If you have already signed up, try signing in or resetting your password.',code:'signup_not_completed'},400);
 if(action==='signin'&&(code==='invalid_credentials'||code==='email_not_confirmed'))return json({error:'Sign-in failed. Check your email and password, and confirm your email first.',code:'signin_failed'},401);
 return json({error:'The account service is temporarily unavailable. Please try again shortly. Guest chat remains available.',code:'account_service_unavailable'},503);
}
const credentials=z.object({email:z.string().email().max(254),password:z.string().min(1).max(256),name:z.string().trim().max(120).optional()}).strict();
export async function handleEmailAuth(request:Request,values:AuthValues,client:SupabaseClient|null){
 const action=new URL(request.url).pathname.split('/').filter(Boolean).at(-1),config=emailAuthConfig(values);
 if(request.method==='GET'&&action==='status')return json({configured:!!config,signupEnabled:!!config?.signupEnabled});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Use the Archindus account form.'},403);
 if(!client)return json({error:'Email accounts are being configured. You can continue as a guest.'},503);
 const origin=new URL(request.url).origin;
 if(action==='confirm'){
  try{z.object({}).strict().parse(await boundedAccountJson(request,1000))}catch{return json({error:'Invalid confirmation request.'},400)}
  const pending=parseCookieHeader(request.headers.get('cookie')??'').find(c=>c.name===PENDING_EMAIL_COOKIE)?.value??'';
  const [type,token]=pending.split(':');const kind=confirmationType(type);
  if(!kind||!validConfirmationToken(token))return json({error:'This confirmation link has expired. Request a new email.',code:'confirmation_expired'},400);
  const {error}=await client.auth.verifyOtp({token_hash:token,type:kind});
  if(error&&(!error.status||error.status>=500))return accountFailure(error,'signin');
  const response=error?json({error:'This confirmation link has expired or was already used. Try signing in, or request a new confirmation email.',code:'confirmation_expired'},400):json(kind==='recovery'?{resetRequired:true}:{signedIn:true});
  response.headers.append('Set-Cookie',serializeCookieHeader(PENDING_EMAIL_COOKIE,'',{path:'/api/auth/confirm',httpOnly:true,secure:true,sameSite:'lax',maxAge:0}));return response;
 }
 let input:unknown;try{input=await boundedAccountJson(request,8000)}catch{return json({error:'Check the account form fields.'},400)}
 try{
  if(action==='signout'){const {error}=await client.auth.signOut({scope:'local'});return error?json({error:'Sign out could not complete. Please retry.'},503):json({signedOut:true})}
  if(action==='signin'||action==='signup'){
   const body=credentials.parse(input);
   if(action==='signup'){
    if(!config?.signupEnabled)return json({error:'Public email signup is waiting for the verification-email sender to be configured. Guest chat is available.'},503);
    if(body.password.length<12)return json({error:'Use a password of at least 12 characters.'},400);
    const {error}=await client.auth.signUp({email:body.email,password:body.password,options:{emailRedirectTo:origin+'/auth/confirm',data:{name:body.name??''}}});
    return error?accountFailure(error,'signup'):json({confirmationRequired:true,message:'Check your inbox to confirm your email before signing in.'});
   }
   const {data,error}=await client.auth.signInWithPassword({email:body.email,password:body.password});if(error)return accountFailure(error,'signin');if(!data.user?.email_confirmed_at){await client.auth.signOut({scope:'local'});return json({error:'Sign-in failed. Check your email and password, and confirm your email first.'},401)}return json({signedIn:true});
  }
  if(action==='verify-code'){
   const {email,token,purpose}=z.object({email:z.string().email().max(254),token:z.string().regex(/^\d{6,10}$/),purpose:z.enum(['signup','recovery'])}).strict().parse(input);
   const {data,error}=await client.auth.verifyOtp({email,token,type:purpose==='recovery'?'recovery':'email'});
   if(error?.status===429||error&&(!error.status||error.status>=500))return accountFailure(error,'signin');
   if(error||!data.user?.email_confirmed_at||!data.session)return json({error:'The code is invalid or has expired. Use the newest email or request another one.'},400);
   return json(purpose==='recovery'?{resetRequired:true}:{signedIn:true});
  }
  if(action==='resend'){
   const {email}=z.object({email:z.string().email().max(254)}).strict().parse(input);if(!config?.signupEnabled)return json({error:'Email verification delivery is being configured.'},503);
   const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:origin+'/auth/confirm'}});
   if(error&&[429,500,502,503,504].includes(error.status??0))return accountFailure(error,'signup');
   return json({message:'If this address has an unconfirmed account, a new confirmation email will arrive shortly. Use only the newest email. If already confirmed, sign in.'});
  }
  if(action==='recover'){
   const {email}=z.object({email:z.string().email().max(254)}).strict().parse(input);if(!config?.signupEnabled)return json({error:'Password-reset email delivery is being configured.'},503);
   // Always return the same response for existing and unknown emails.
   await client.auth.resetPasswordForEmail(email,{redirectTo:origin+'/auth/confirm?next=reset'});return json({message:'If that email has an account, a password-reset link will arrive shortly.'});
  }
  if(action==='password'){
   const {password}=z.object({password:z.string().min(12).max(256)}).strict().parse(input);const {data,error}=await client.auth.getUser();if(error||!data.user?.email_confirmed_at)return json({error:'Open a valid password-reset link first.'},401);
   const result=await client.auth.updateUser({password});if(result.error)return json({error:'Password could not be updated. Please retry or request a new link.'},400);await client.auth.signOut({scope:'global'});return json({message:'Password updated. Sign in with your new password.'});
  }
  return json({error:'Not found.'},404);
 }catch(error){return error instanceof z.ZodError?json({error:'Check the account form fields.'},400):accountFailure(error,action==='signup'?'signup':action==='recover'?'recover':'signin')}
}
export async function confirmEmail(request:Request,client:SupabaseClient|null){
 const url=new URL(request.url),code=url.searchParams.get('code'),token=url.searchParams.get('token_hash'),kind=confirmationType(url.searchParams.get('type'));
 let path='/auth?error=confirmation';const headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 if(url.searchParams.has('error'))path=url.searchParams.get('error_code')==='otp_expired'?'/auth?error=expired':'/auth?error=confirmation';
 else if(client&&validConfirmationToken(token)&&kind){
  // An email scanner can open GET links without consuming the one-time token.
  // User confirmation POST exchanges it; remove the token from the address bar first.
  headers.append('Set-Cookie',serializeCookieHeader(PENDING_EMAIL_COOKIE,kind+':'+token,{path:'/api/auth/confirm',httpOnly:true,secure:true,sameSite:'lax',maxAge:600}));path='/auth?confirm=pending';
 }else if(client&&code&&code.length<4096){
  const hasVerifier=parseCookieHeader(request.headers.get('cookie')??'').some(c=>c.name==='archindus-auth-code-verifier'&&!!c.value);
  if(!hasVerifier)path='/auth?error=browser';
  else{const {error}=await client.auth.exchangeCodeForSession(code);if(!error)path=url.searchParams.get('next')==='reset'?'/auth?mode=update':'/';else{const reason=error.code==='flow_state_expired'||error.code==='flow_state_not_found'||error.code==='otp_expired'?'expired':error.status&&error.status>=500?'service':'browser';path='/auth?error='+reason}}
 }
 headers.set('Location',new URL(path,url.origin).toString());return new Response(null,{status:303,headers});
}
