/** Fixed owner-operated service; its API key and cost ledger stay on the original Site. */
export const SHARED_RUNTIME_ORIGIN = "https://architect-industries.stevenscadet.chatgpt.site";
export type RuntimeRoute = "status" | "chat" | "hosted";
const json = (error: string, status: number) => Response.json({ error }, {
 status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
export async function relayRuntime(request: Request, route: RuntimeRoute, send: typeof fetch = fetch): Promise<Response> {
 if (!["status", "chat", "hosted"].includes(route)) return json("Unknown runtime route.", 404);
 const statusRequest = route === "status";
 if (request.method !== (statusRequest ? "GET" : "POST")) return json("Method not allowed.", 405);
 if (!statusRequest && (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json"))) return json("Send this request from Archindus.", 403);
 let body: Uint8Array | undefined;
 if (!statusRequest) {
  const reader = request.body?.getReader(); if (!reader) return json("Empty request.", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
   while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 150_000) { await reader.cancel(); return json("The request is too large.", 413); }
    chunks.push(chunk.value);
   }
   body = new Uint8Array(size); let offset = 0;
   for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  } catch { return json("The request could not be read.", 400); }
  finally { reader.releaseLock(); }
 }
 try {
  // Never forward visitor cookies, Authorization, or arbitrary headers.
  const response = await send(`${SHARED_RUNTIME_ORIGIN}/api/archindus/${route}`, {
   method: statusRequest ? "GET" : "POST",
   headers: statusRequest ? { Accept: "application/json" } : { "Content-Type": "application/json", Origin: SHARED_RUNTIME_ORIGIN, Accept: "application/json, text/event-stream, image/png" },
   body: body as BodyInit | undefined,
   signal: AbortSignal.any([request.signal, AbortSignal.timeout(statusRequest ? 4500 : 125_000)]),
   cache: "no-store", redirect: "error",
  });
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  for (const key of ["content-type", "retry-after", "content-disposition", "x-archindus-model"]) {
   const value = response.headers.get(key); if (value) headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
 } catch {
  if (statusRequest) return Response.json({ configured: false, online: false, hosted: { configured: true, available: false } }, { headers: { "Cache-Control": "no-store" } });
  return json("The connected Archindus service is unavailable. Try again shortly.", 503);
 }
}
