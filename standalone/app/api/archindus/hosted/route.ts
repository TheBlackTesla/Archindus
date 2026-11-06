import { hostedEnvironment } from "../../../../lib/inference/environment";
import { handleHosted } from "../../../../lib/inference/hosted";
import {accountIdentity,accountPersonalization,type AccountDb} from '../../../../lib/account';

export async function POST(request: Request) {
  const environment=hostedEnvironment();
  return handleHosted(request,{...environment,personalize:(temporary,personalityId)=>accountPersonalization(environment.db as AccountDb|undefined,accountIdentity(request),temporary,personalityId)});
}
