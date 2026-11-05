import { hostedEnvironment } from "../../../../lib/inference/environment";
import { handleHosted } from "../../../../lib/inference/hosted";

async function independentPOST(request: Request) {
  return handleHosted(request, hostedEnvironment());
}

import { relayRuntime } from "../../../../lib/inference/shared-runtime";

export async function POST(request: Request) {
 return process.env.ARCHINDUS_RUNTIME_MODE === "independent" ? independentPOST(request) : relayRuntime(request, "hosted");
}
