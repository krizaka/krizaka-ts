/** The processor's form encoding: nested keys as `a[b][0][c]=v`. */
export function formEncode(value: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${key}[${i}]`));
    else if (typeof v === "object") for (const [k, item] of Object.entries(v)) walk(item, key ? `${key}[${k}]` : k);
    else out.append(key, String(v));
  };
  walk(value, "");
  return out;
}

export interface RawCallConfig {
  secretKey: string;
  fetch?: typeof fetch;
  apiBase?: string;
}

/** One HTTP call to the processor: no SDK, the caller's `fetch`. Returns the status and the parsed body. */
export async function rawCall(
  config: RawCallConfig,
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown> = {},
  idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> & { error?: { message?: string } } }> {
  const doFetch = config.fetch ?? fetch;
  const base = (config.apiBase ?? "https://api.stripe.com").replace(/\/$/, "");
  const form = formEncode(params);
  const res = await doFetch(`${base}${path}${method === "GET" && form.size ? `?${form}` : ""}`, {
    method,
    headers: { authorization: `Bearer ${config.secretKey}`, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: method === "POST" ? form : undefined,
  });
  return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as never };
}
