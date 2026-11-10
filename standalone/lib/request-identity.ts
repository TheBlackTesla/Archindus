export type VerifiedIdentity={id:string;name:string;email:string;provider?:'email'|'chatgpt'};
// Request-local verified identity, never accepted from client-provided headers.
const identities=new WeakMap<Request,VerifiedIdentity|null>();
export const setEmailIdentity=(request:Request,user:VerifiedIdentity|null)=>identities.set(request,user);
export const emailIdentity=(request:Request)=>identities.get(request);
