import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const root=new URL('../',import.meta.url).pathname;
await build({stdin:{contents:["export * from './lib/email-auth'","export * from './lib/account'"].join(';'),resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',outfile:root+'outputs/email-auth-test.mjs',logLevel:'silent'});
const app=await import('../outputs/email-auth-test.mjs');
const values={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',ARCHINDUS_EMAIL_SIGNUP_ENABLED:'true'};
function request(path,body,cookie,origin='https://site.test'){return new Request('https://site.test'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})})}
const user={id:'11111111-1111-4111-8111-111111111111',email:'alice@example.test',email_confirmed_at:'2026-01-01T00:00:00Z',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{name:'Alice'},created_at:'2026-01-01T00:00:00Z'};
const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:'authenticated',session_id:'22222222-2222-4222-8222-222222222222'})).toString('base64url')+'.test';
const session={access_token:jwt,refresh_token:'test-refresh-secret',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
let storedCookie='';
const mock=async(input,init)=>{const path=new URL(String(input)).pathname;if(path.endsWith('/token'))return Response.json(session);if(path.endsWith('/user'))return Response.json(user);if(path.endsWith('/logout'))return new Response(null,{status:204});return Response.json({user})};
test('signup and sign-in reject cross-origin requests and oversized/unexpected fields before credentials leave server',async()=>{let calls=0;const send=async(...args)=>{calls++;return mock(...args)};for(const req of [request('/api/auth/signin',{email:user.email,password:'secret'},undefined,'https://evil.test'),request('/api/auth/signin',{email:user.email,password:'secret',userId:'victim'}),request('/api/auth/signup',{email:user.email,password:'short'})]){const r=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),send);assert.ok([400,403].includes(r.status))}assert.equal(calls,0)});
test('unconfigured email sender blocks public signup rather than silently bypassing verification',async()=>{const config={...values,ARCHINDUS_EMAIL_SIGNUP_ENABLED:'false'},req=request('/api/auth/signup',{email:user.email,password:'secure-long-password'});let calls=0;const r=await app.withEmailAuth(req,config,c=>app.handleEmailAuth(req,config,c),async()=>{calls++;return Response.json({})});assert.equal(r.status,503);assert.equal(calls,0)});
test('verified email sign-in sets HttpOnly Secure cookies and never returns access/refresh tokens in JSON',async()=>{const req=request('/api/auth/signin',{email:user.email,password:'secure-long-password'});const r=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),mock);assert.equal(r.status,200);const cookies=r.headers.getSetCookie();assert.ok(cookies.some(c=>c.startsWith('archindus-auth=')));for(const cookie of cookies){assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Lax/i)}storedCookie=cookies.filter(c=>c.startsWith('archindus-auth')).map(c=>c.split(';')[0]).join('; ');assert.doesNotMatch(await r.text(),/test-refresh-secret|access_token|refresh_token/)});
test('account authorization validates cookies with Supabase and uses a separate namespaced identity',async()=>{assert.ok(storedCookie);const req=request('/api/account',undefined,storedCookie);let calls=0;const r=await app.withEmailAuth(req,values,()=>Response.json(app.accountIdentity(req)),async(...args)=>{calls++;return mock(...args)});const identity=await r.json();assert.equal(identity.id,'email:project:'+user.id);assert.equal(identity.provider,'email');assert.equal(calls,1);const failed=request('/api/account',undefined,storedCookie);const denied=await app.withEmailAuth(failed,values,()=>Response.json({user:app.accountIdentity(failed)}),async()=>Response.json({message:'Invalid JWT',code:'bad_jwt'},{status:401}));assert.equal((await denied.json()).user,null)});
test('guest requests make no authentication network call and forged identity headers cannot supply an email identity',async()=>{const req=request('/api/account');req.headers.set('x-archindus-user-id','victim');req.headers.set('authorization','Bearer fake-token');const r=await app.withEmailAuth(req,values,()=>Response.json({user:app.accountIdentity(req)}),async()=>{throw Error('Guest made a network request')});assert.equal((await r.json()).user,null)});
test('confirmation callback accepts only a code exchange and fixed same-origin destinations',async()=>{for(const query of ['?next=https://evil.test','?code=invalid&next=https://evil.test']){const req=request('/auth/confirm'+query);const r=await app.withEmailAuth(req,values,c=>app.confirmEmail(req,c),async()=>Response.json({error:'invalid_grant',error_description:'Invalid code'},{status:400}));assert.equal(r.status,303);assert.equal(new URL(r.headers.get('Location')).origin,'https://site.test');assert.doesNotMatch(r.headers.get('Location'),/evil|invalid/)}});
test('signout clears session cookies; a malformed endpoint cannot redirect credentials',async()=>{const req=request('/api/auth/signout',{},storedCookie);const r=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),mock);assert.equal(r.status,200);assert.ok(r.headers.getSetCookie().some(c=>c.startsWith('archindus-auth=;')));assert.equal(app.emailAuthConfig({...values,SUPABASE_URL:'https://evil.test'}),null)});
test('signup uses Worker-compatible redirect handling and never follows a redirect',async()=>{
 const req=request('/api/auth/signup',{email:user.email,password:'secure-long-password'});
 const options=[];
 const result=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),async(input,init)=>{
  options.push(init.redirect);
  assert.equal(new URL(input).pathname,'/auth/v1/signup');
  if(init.redirect!=='manual')throw new TypeError('Unsupported redirect mode');
  return new Response(null,{status:307,headers:{Location:'https://evil.test'}});
 });
 assert.deepEqual(options,['manual']);
 assert.equal(result.status,503);
 assert.equal((await result.json()).code,'account_service_unavailable');
});
test('signup returns the confirmation step after Supabase accepts the request',async()=>{
 const req=request('/api/auth/signup',{email:user.email,password:'secure-long-password'});
 const result=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),async(input,init)=>{
  const url=new URL(input);
  assert.equal(url.pathname,'/auth/v1/signup');
  assert.equal(url.searchParams.get('redirect_to'),'https://site.test/auth/confirm');
  assert.equal(init.redirect,'manual');
  return Response.json({...user,email_confirmed_at:undefined});
 });
 assert.equal(result.status,200);
 assert.equal((await result.json()).confirmationRequired,true);
 assert.ok(result.headers.getSetCookie().some(cookie=>cookie.startsWith('archindus-auth-code-verifier=')));
});

 test('account service outages, sender restrictions and rate limits are distinguished without exposing provider details',async()=>{
  for(const [status,code,expected,publicCode] of [[503,'unexpected_failure',503,'account_service_unavailable'],[401,'invalid_api_key',503,'account_service_unavailable'],[400,'email_address_not_authorized',503,'email_delivery_unavailable'],[429,'over_email_send_rate_limit',429,'account_rate_limited'],[422,'weak_password',400,'weak_password'],[400,'email_address_invalid',400,'invalid_email']]){
   const req=request('/api/auth/signup',{email:user.email,password:'secure-long-password'});
   const r=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),async()=>Response.json({code,msg:'private upstream details '+user.email},{status,headers:{'x-supabase-api-version':'2024-01-01'}}));
   assert.equal(r.status,expected);const text=await r.text();assert.equal(JSON.parse(text).code,publicCode);assert.doesNotMatch(text,/private upstream|alice@|invalid_api_key/);
  }
 });
 test('sign-in reports service failures without claiming invalid credentials',async()=>{
  for(const action of ['signin']){const req=request('/api/auth/'+action,{email:user.email,...(action==='signin'?{password:'secure-long-password'}:{})});const r=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),async()=>Response.json({code:'unexpected_failure',msg:'private'},{status:503}));assert.equal(r.status,503);assert.equal((await r.json()).code,'account_service_unavailable')}
 });
test('confirmation links stage a short-lived token without consuming it on GET and verify on same-origin POST',async()=>{
 const token='a'.repeat(64);let calls=0;
 const req=request('/auth/confirm?token_hash='+token+'&type=email&next=https://evil.test');
 const staged=await app.withEmailAuth(req,values,c=>app.confirmEmail(req,c),async()=>{calls++;throw Error('GET consumed email token')});
 assert.equal(calls,0);assert.equal(staged.status,303);assert.equal(staged.headers.get('Location'),'https://site.test/auth?confirm=pending');
 assert.equal(staged.headers.get('Referrer-Policy'),'no-referrer');const cookie=staged.headers.getSetCookie().find(c=>c.startsWith('archindus-email-confirmation='));assert.ok(cookie);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/Max-Age=600/);
 const post=request('/api/auth/confirm',{},cookie.split(';')[0]);
 const completed=await app.withEmailAuth(post,values,c=>app.handleEmailAuth(post,values,c),async(input,init)=>{calls++;assert.equal(new URL(input).pathname,'/auth/v1/verify');const body=JSON.parse(init.body);assert.equal(body.token_hash,token);assert.equal(body.type,'email');return Response.json(session)});
 assert.equal(completed.status,200);assert.equal((await completed.json()).signedIn,true);assert.equal(calls,1);assert.ok(completed.headers.getSetCookie().some(c=>c.startsWith('archindus-auth=')));assert.ok(completed.headers.getSetCookie().some(c=>c.startsWith('archindus-email-confirmation=;')));
});
test('recovery token uses the reset screen and invalid or cross-origin confirmations never reach Supabase',async()=>{
 let calls=0;for(const query of ['?token_hash=short&type=email','?token_hash='+'b'.repeat(64)+'&type=invite','?error=access_denied&error_code=otp_expired']){const req=request('/auth/confirm'+query);const r=await app.withEmailAuth(req,values,c=>app.confirmEmail(req,c),async()=>{calls++;throw Error('Unexpected exchange')});assert.equal(r.status,303);assert.doesNotMatch(r.headers.get('Location'),/token_hash|evil/);if(query.includes('otp_expired'))assert.match(r.headers.get('Location'),/error=expired/)}
 const cross=request('/api/auth/confirm',{},'archindus-email-confirmation=email%3A'+'a'.repeat(64),'https://evil.test');const denied=await app.withEmailAuth(cross,values,c=>app.handleEmailAuth(cross,values,c),async()=>{calls++;throw Error('Cross-origin exchange')});assert.equal(denied.status,403);assert.equal(calls,0);
 const req=request('/api/auth/confirm',{},'archindus-email-confirmation=recovery%3A'+'a'.repeat(64));const r=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),async()=>Response.json(session));assert.equal((await r.json()).resetRequired,true);
});
test('legacy PKCE confirmation keeps the verifier and maps missing context accurately',async()=>{
 let calls=0;const missing=request('/auth/confirm?code=test');const failed=await app.withEmailAuth(missing,values,c=>app.confirmEmail(missing,c),async()=>{calls++;throw Error('Missing verifier')});assert.match(failed.headers.get('Location'),/error=browser/);assert.equal(calls,0);
 const signup=request('/api/auth/signup',{email:user.email,password:'secure-long-password'});const created=await app.withEmailAuth(signup,values,c=>app.handleEmailAuth(signup,values,c),async()=>Response.json({...user,email_confirmed_at:undefined}));const verifier=created.headers.getSetCookie().find(c=>c.startsWith('archindus-auth-code-verifier=')).split(';')[0];const req=request('/auth/confirm?code=test&next=https://evil.test',undefined,verifier);const r=await app.withEmailAuth(req,values,c=>app.confirmEmail(req,c),async(input,init)=>{calls++;assert.equal(new URL(input).pathname,'/auth/v1/token');assert.ok(JSON.parse(init.body).code_verifier.length>20);return Response.json(session)});assert.equal(r.headers.get('Location'),'https://site.test/');assert.equal(calls,1);
});
test('resending confirmation uses the fixed callback and does not disclose account existence',async()=>{
 const req=request('/api/auth/resend',{email:user.email});const r=await app.withEmailAuth(req,values,c=>app.handleEmailAuth(req,values,c),async(input,init)=>{assert.equal(new URL(input).pathname,'/auth/v1/resend');assert.equal(new URL(input).searchParams.get('redirect_to'),'https://site.test/auth/confirm');assert.equal(JSON.parse(init.body).type,'signup');return Response.json({})});assert.equal(r.status,200);assert.match((await r.json()).message,/If this address/);
});
