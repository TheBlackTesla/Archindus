import {environmentForRequest} from '../../../../lib/inference/user-environment';
const STATUS_TIMEOUT_MS = 2_500;

function qwenUrl(path: string) {
  const endpoint = process.env.ARCHINDUS_QWEN_ENDPOINT?.trim();
  if (!endpoint) return null;
  return new URL(path, endpoint.endsWith("/") ? endpoint : `${endpoint}/`).toString();
}

function qwenHeaders() {
  const apiKey = process.env.ARCHINDUS_QWEN_API_KEY?.trim();
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
}

export async function GET(request:Request) {
  const environment = await environmentForRequest(request);
  const hostedConfigured = Boolean(environment.enabled && (environment.key||environment.providers.length) && environment.db);
  let hostedAvailable = false;
  if (hostedConfigured) {
    try { for(const provider of [...(environment.key?['openai']:[]),...environment.providers.map(p=>p.id)])if(await budgetAvailable(environment.db!,environment.limits,Date.now(),provider)){hostedAvailable=true;break;} }
    catch { /* Missing/unavailable cost ledger disables paid calls. */ }
  }
  const hosted = { configured: hostedConfigured, available: hostedAvailable };
  const modelsUrl = qwenUrl("models");
  const model = process.env.ARCHINDUS_QWEN_MODEL?.trim() || "Qwen/Qwen3.8-27B";

  if (!modelsUrl) {
    return Response.json(
      { configured: false, online: false, model, hosted },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const response = await fetch(modelsUrl, {
      headers: qwenHeaders(),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      cache: "no-store",
    });
    return Response.json(
      { configured: true, online: response.ok, model, hosted },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { configured: true, online: false, model, hosted },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
import { hostedEnvironment } from "../../../../lib/inference/environment";
import { budgetAvailable } from "../../../../lib/inference/budget";
