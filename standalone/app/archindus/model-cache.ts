const MISS = "Missing saved browser model files. Open Settings and choose Repair missing files.";
export function cacheAwareFetch(network: typeof fetch, storage: CacheStorage | undefined, origin: string, cachedOnly: () => boolean): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, origin);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method !== "GET") throw new Error("Model assets require read-only requests.");
    try { const saved = await storage?.match(input); if (saved?.ok) return saved; } catch { /* Miss, not permission to download. */ }
    const appCode = url.origin === origin && url.pathname.startsWith("/assets/") && /\.m?js$/.test(url.pathname);
    if (cachedOnly() && !appCode) throw new Error(MISS);
    const response = await network(input, init);
    if (response.ok && /\/ort-wasm[^/]*\.wasm$/.test(url.pathname)) {
      if (!storage) throw new Error("Browser storage is unavailable.");
      await (await storage.open("archindus-runtime-v1")).put(input,response.clone());
    }
    return response;
  };
}
// Cache.add performs its own fetch. Overriding global fetch alone does not protect WebLLM.
// This guard is installed inside the GPU worker only.
export function guardCacheAcquisition(proto: Pick<Cache,"add"|"addAll"> | undefined, cachedOnly: () => boolean) {
  if (!proto) return;
  const add = proto.add, all = proto.addAll;
  proto.add = async function(this: Cache, request) {
    if (await this.match(request)) return;
    if (cachedOnly()) throw new Error(MISS);
    return add.call(this,request);
  };
  proto.addAll = async function(this: Cache, requests) {
    const missing: RequestInfo[] = [];
    for (const r of requests) if (!await this.match(r)) missing.push(r);
    if (!missing.length) return;
    if (cachedOnly()) throw new Error(MISS);
    return all.call(this,missing);
  };
}
export function localCacheOptions(environment: { allowLocalModels: boolean }, cachedOnly: boolean) {
  environment.allowLocalModels = cachedOnly; return {local_files_only: cachedOnly};
}
