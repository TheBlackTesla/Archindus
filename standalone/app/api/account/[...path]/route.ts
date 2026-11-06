import {env} from 'cloudflare:workers';
import {handleAccount,type AccountDb} from '../../../../lib/account';
const handle=(request:Request)=>handleAccount(request,(env as unknown as {DB?:AccountDb}).DB,{credentialsKey:(env as unknown as {ARCHINDUS_CREDENTIALS_KEY?:string}).ARCHINDUS_CREDENTIALS_KEY});
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
