// Node SSR checks do not provide Cloudflare's built-in environment module.
// The homepage does not use bindings; API/accounting checks inject a real SQL
// database separately. Production deployment verifies the actual D1 binding.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = {};", shortCircuit: true };
  return nextResolve(specifier, context);
}
