/** All amounts are integer microdollars (1 USD = 1,000,000).
 * One atomic INSERT authorizes both spending and rate/concurrency capacity.
 * Missing storage, invalid settings, and ambiguous failures never grant credit.
 */
export type Statement = { bind(...args: unknown[]): Statement; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> };
export type UsageDb = { prepare(sql: string): Statement };
export type Limits = { day: number; month: number };
export const DEFAULT_LIMITS: Limits = { day: 1_000_000, month: 10_000_000 };
export async function providerCooldownSeconds(db: UsageDb, now = Date.now(), provider="openai") {
  const row = await db.prepare("SELECT unavailable_until FROM inference_provider_state WHERE provider = ?")
    .bind(provider).first<{ unavailable_until: number }>();
  return Math.max(0, Math.ceil(((row?.unavailable_until ?? 0) - now) / 1000));
}
export async function pauseProvider(db: UsageDb, seconds: number, now = Date.now(), provider="openai") {
  // A later short outage must not shorten an existing account-credit cooldown.
  await db.prepare(`INSERT INTO inference_provider_state (provider, unavailable_until)
    VALUES (?, ?) ON CONFLICT(provider) DO UPDATE SET
    unavailable_until = MAX(inference_provider_state.unavailable_until, excluded.unavailable_until)`)
    .bind(provider, now + seconds * 1000).run();
}
export function configuredLimits(day?: string, month?: string): Limits {
  const amount = (value: string | undefined, ceiling: number) => {
    if (value === undefined || value === "") return ceiling;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(ceiling, Math.floor(parsed * 1_000_000)) : 0;
  };
  return { day: amount(day, DEFAULT_LIMITS.day), month: amount(month, DEFAULT_LIMITS.month) };
}
export async function clientKey(request: Request, secret: string, day: string) {
  // Sites supplies identity; Cloudflare supplies IP. Without either, share a bucket.
  // Never trust an X-Forwarded-For or a client-selected identifier for quotas.
  const ip = request.headers.get('oai-authenticated-user-id') ?? request.headers.get("cf-connecting-ip") ?? "shared-anonymous";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${day}:${ip}`));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function reserve(db: UsageDb, input: { id: string; client: string; kind: "text" | "image" | "video"; provider?:string; zeroCost?:boolean; activeMs?:number; amount: number; now: number; limits: Limits }) {
  const { id, client, kind, amount, now, limits } = input;
  if (!Number.isSafeInteger(amount) || (amount < 0 || amount === 0 && !input.zeroCost)) return false;
  const date = new Date(now).toISOString(), day = date.slice(0, 10), month = date.slice(0, 7);
  const row = await db.prepare(`INSERT INTO inference_usage
    (id, day, month, client, kind, reserved, charged, created_at, active_until)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ? <= ? AND ? <= ?
      AND NOT EXISTS (SELECT 1 FROM inference_provider_state WHERE provider = ? AND unavailable_until > ?)
      AND NOT EXISTS (SELECT 1 FROM inference_usage WHERE charged > reserved)
      AND COALESCE((SELECT SUM(charged) FROM inference_usage WHERE day = ?), 0) + ? <= ?
      AND COALESCE((SELECT SUM(charged) FROM inference_usage WHERE month = ?), 0) + ? <= ?
      AND (SELECT COUNT(*) FROM inference_usage WHERE day = ? AND client = ? AND kind = ?) < ?
      AND (SELECT COUNT(*) FROM inference_usage WHERE day = ? AND client = ? AND kind = ? AND created_at > ?) < ?
      AND (SELECT COUNT(*) FROM inference_usage WHERE created_at > ?) < 30
      AND (SELECT COUNT(*) FROM inference_usage WHERE active_until > ?) < 4
    ON CONFLICT(id) DO NOTHING RETURNING id`).bind(
    id, day, month, client, kind, amount, amount, now, now + Math.max(130000,Math.min(900000,input.activeMs??130000)),
    amount, limits.day, amount, limits.month,
    input.provider??"openai",now,
    day, amount, limits.day, month, amount, limits.month,
    day, client, kind, kind === "video" ? 2 : kind === "image" ? 5 : 100,
    // Permit one four-image gallery batch; the five-per-day cap is unchanged.
    day, client, kind, now - 60_000, kind === "video" ? 1 : kind === "image" ? 4 : 6,
    now - 60_000, now,
  ).first<{ id: string }>();
  return Boolean(row);
}
export async function settle(db: UsageDb, id: string, actual?: number) {
  // Unknown usage (timeouts, cancellation, invalid/error responses) retains the
  // full reservation. Only a valid, smaller provider usage report releases it.
  await db.prepare(`UPDATE inference_usage SET active_until = 0,
    charged = CASE WHEN ? >= 0 THEN ? ELSE charged END
    WHERE id = ? AND active_until != 0`).bind(Number.isSafeInteger(actual) ? actual : -1, Number.isSafeInteger(actual) ? actual : -1, id).run();
}
export async function budgetAvailable(db: UsageDb, limits: Limits, now = Date.now(), provider="openai") {
  const date = new Date(now).toISOString();
  const row = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN day = ? THEN charged ELSE 0 END), 0) AS daily,
    COALESCE(SUM(charged), 0) AS monthly,
    (SELECT COUNT(*) FROM inference_usage WHERE charged > reserved) AS overruns,
    (SELECT COUNT(*) FROM inference_provider_state WHERE provider = ? AND unavailable_until > ?) AS cooling
    FROM inference_usage WHERE month = ?`)
    .bind(date.slice(0, 10), provider, now, date.slice(0, 7)).first<{ daily: number; monthly: number; overruns: number; cooling: number }>();
  return Boolean(row && !row.overruns && !row.cooling && row.daily < limits.day && row.monthly < limits.month);
}
