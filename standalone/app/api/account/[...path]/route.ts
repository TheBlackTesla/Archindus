import {env} from 'cloudflare:workers';
import {handleAccount,type AccountDb} from '../../../../lib/account';
const handle=(request:Request)=>handleAccount(request,(env as unknown as {DB?:AccountDb}).DB);
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
