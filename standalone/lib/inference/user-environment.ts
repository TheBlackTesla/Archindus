import {env} from 'cloudflare:workers';
import {accountIdentity,type AccountDb} from '../account';
import {userConnectionValues} from './integrations';
import {providerConfiguration} from './providers';
import {hostedEnvironment} from './environment';
export async function environmentForRequest(request:Request){const values=env as unknown as Record<string,unknown>,environment=hostedEnvironment(),user=accountIdentity(request);const own=await userConnectionValues(environment.db as AccountDb|undefined,user?.id,typeof values.ARCHINDUS_CREDENTIALS_KEY==='string'?values.ARCHINDUS_CREDENTIALS_KEY:undefined);
 const combined={...values,...own};const globalModels=typeof values.ARCHINDUS_PROVIDER_MODELS==='string'?values.ARCHINDUS_PROVIDER_MODELS:'{}';if(own.ARCHINDUS_PROVIDER_MODELS){let base={};try{base=JSON.parse(globalModels)}catch{}combined.ARCHINDUS_PROVIDER_MODELS=JSON.stringify({...base,...JSON.parse(own.ARCHINDUS_PROVIDER_MODELS)});}
 return {...environment,providers:providerConfiguration(combined).providers,values:combined};
}
