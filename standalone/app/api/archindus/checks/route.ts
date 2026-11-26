import {env} from 'cloudflare:workers';
import {hostedEnvironment} from '../../../../lib/inference/environment';
import {modelChecks} from '../../../../lib/inference/model-checks';
import type {AccountDb} from '../../../../lib/account';
const handle=(request:Request)=>modelChecks(request,env.DB as AccountDb|undefined,hostedEnvironment(),env.ARCHINDUS_MODEL_CHECK_DAY);
export {handle as GET,handle as POST};
