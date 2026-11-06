import {createServerClient,parseCookieHeader,serializeCookieHeader} from '@supabase/ssr';
import type {SupabaseClient} from '@supabase/supabase-js';
import {setEmailIdentity} from './request-identity';
import {boundedAccountJson} from './account';
import {z} from 'zod';
export type AuthValues=Record<string,unknown>;
export function emailAuthConfig(values:AuthValues){const url=values.SUPABASE_URL,key=values.SUPABASE_PUBLISHABLE_KEY;if(typeof url!=='string'||typeof key!=='string'||!key)return null;try{const parsed=new URL(url);if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||parsed.username||parsed.password||parsed.pathname!=='/')return null;return {url:parsed.origin,key,signupEnabled:values.ARCHINDUS_EMAIL_SIGNUP_ENABLED==='true'}}catch{return null}}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function withEmailAuth(request:Request,values:AuthValues,handler:(client:SupabaseClient|null)=>Promise<Response>|Response,send:typeof fetch=fetch){
 const config=emailAuthConfig(values);if(!config)return handler(null);
 const pending=new Map<string,string>();const incoming=parseCookieHeader(request.headers.get('cookie')??'');
 const client=createServerClient(config.url,config.key,{cookieOptions:{name:'archindus-auth',path:'/',sameSite:'lax',httpOnly:true,secure:new URL(request.url).protocol==='https:'},global:{fetch:(input,init)=>send(input,{...init,redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])})},cookies:{getAll:()=>incoming.map(c=>({name:c.name,value:c.value??''})),setAll:cookies=>{for(const cookie of cookies){pending.set(cookie.name,serializeCookieHeader(cookie.name,cookie.value,{...cookie.options,path:'/',httpOnly:true,sameSite:'lax',secure:new URL(request.url).protocol==='https:'}));const current=incoming.find(c=>c.name===cookie.name);if(current)current.value=cookie.value;else incoming.push(cookie)}}}});
 try{
  if(incoming.some(c=>/^archindus-auth(?:\.\d+)?$/.test(c.name))){
   setEmailIdentity(request,null);const {data,error}=await client.auth.getUser();
   if(!error&&data.user?.email_confirmed_at&&data.user.email)setEmailIdentity(request,{id:'email:'+new URL(config.url).hostname.split('.')[0]+':'+data.user.id,email:data.user.email,name:typeof data.user.user_metadata?.name==='string'?data.user.user_metadata.name.slice(0,120):'',provider:'email'});
  }
  const response=await handler(client),headers=new Headers(response.headers);for(const value of pending.values())headers.append('Set-Cookie',value);if(pending.size){headers.set('Cache-Control','no-store');headers.set('Vary','Cookie')}
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }catch{return json({error:'Account service is temporarily unavailable. Guest chat remains available.'},503)}
}
const credentials=z.object({email:z.string().email().max(254),password:z.string().min(1).max(256),name:z.string().trim().max(120).optional()}).strict();
export async function handleEmailAuth(request:Request,values:AuthValues,client:SupabaseClient|null){
 const action=new URL(request.url).pathname.split('/').filter(Boolean).at(-1),config=emailAuthConfig(values);
 if(request.method==='GET'&&action==='status')return json({configured:!!config,signupEnabled:!!config?.signupEnabled});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Use the Archindus account form.'},403);
 if(!client)return json({error:'Email accounts are being configured. You can continue as a guest.'},503);
 const origin=new URL(request.url).origin;
 try{const input=await boundedAccountJson(request,8000);
  if(action==='signout'){const {error}=await client.auth.signOut({scope:'local'});return error?json({error:'Sign out could not complete. Please retry.'},503):json({signedOut:true})}
  if(action==='signin'||action==='signup'){
   const body=credentials.parse(input);
   if(action==='signup'){
    if(!config?.signupEnabled)return json({error:'Public email signup is waiting for the verification-email sender to be configured. Guest chat is available.'},503);
    if(body.password.length<12)return json({error:'Use a password of at least 12 characters.'},400);
    const {error}=await client.auth.signUp({email:body.email,password:body.password,options:{emailRedirectTo:origin+'/auth/confirm',data:{name:body.name??''}}});
    return error?json({error:'Signup could not complete. Check your details or try again later.'},400):json({confirmationRequired:true,message:'Check your inbox to confirm your email before signing in.'});
   }
   const {data,error}=await client.auth.signInWithPassword({email:body.email,password:body.password});if(error||!data.user?.email_confirmed_at){await client.auth.signOut({scope:'local'});return json({error:'Sign-in failed. Check your email and password, and confirm your email first.'},401)}return json({signedIn:true});
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
 }catch{return json({error:'Check the account form fields.'},400)}
}
export async function confirmEmail(request:Request,client:SupabaseClient|null){const url=new URL(request.url),code=url.searchParams.get('code');let path='/auth?error=confirmation';if(client&&code&&code.length<4096){const {error}=await client.auth.exchangeCodeForSession(code);if(!error)path=url.searchParams.get('next')==='reset'?'/auth?mode=update':'/'}return new Response(null,{status:303,headers:{Location:new URL(path,url.origin).toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})}
