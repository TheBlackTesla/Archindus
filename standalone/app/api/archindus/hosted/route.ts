import { hostedEnvironment } from "../../../../lib/inference/environment";
import { handleHosted } from "../../../../lib/inference/hosted";

export async function POST(request: Request) {
  return handleHosted(request, hostedEnvironment());
}
