import { rawCall } from "./http";

/** One product and price a product sells, as data. Amounts are integer cents, tax exclusive (the processor adds the taxes). */
export interface CataloguePlan {
  lookupKey: string;
  name: string;
  amount: number;
  currency: string;
  interval?: "month" | "year";
  /** The processor's tax code of the product (e.g. software as a service). */
  taxCode?: string;
}

export interface Catalogue {
  /** Marks what this catalogue created (`metadata.product`). */
  product: string;
  plans: CataloguePlan[];
  portal: { headline: string; cancel: "at_period_end" | "immediately" };
}

export type StripeCall = (
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the processor's JSON, read field by field below
) => Promise<Record<string, any>>;

/** The processor's API as one function (errors say which call failed), and the mode its key is in. */
export function stripeCall(config: { secretKey: string; fetch?: typeof fetch; apiBase?: string }): {
  call: StripeCall;
  mode: "test" | "live";
} {
  return {
    mode: config.secretKey.startsWith("sk_live_") ? "live" : "test",
    async call(method, path, params = {}) {
      const { ok, status, json } = await rawCall(config, method, path, params);
      if (!ok) throw new Error(`${method} ${path}: ${json.error?.message ?? status}`);
      return json;
    },
  };
}

export interface SetupResult {
  prices: { lookupKey: string; status: "exists" | "created" | "repriced" }[];
  portal: "exists" | "created";
  webhook?: { status: "exists" } | { status: "updated" } | { status: "created"; secret: string };
  tax: string;
}

const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

type Registration = {
  country: string;
  status: string;
  country_options?: { ca?: { province_standard?: { province?: string } } };
};

type Options = { mode: "test" | "live"; owner?: boolean; webhookUrl?: string };

/** One plan's price: left alone when it is there with the same amount, else made (a changed amount takes over the lookup key). */
async function ensurePrice(
  call: StripeCall,
  product: string,
  plan: CataloguePlan,
): Promise<SetupResult["prices"][number]> {
  const existing = await call("GET", "/v1/prices", { lookup_keys: [plan.lookupKey], active: true, limit: 1 });
  const current = existing.data[0];
  if (current && current.unit_amount === plan.amount && current.currency === plan.currency)
    return { lookupKey: plan.lookupKey, status: "exists" };
  // A price is immutable at the processor: a new amount is a new price that TAKES OVER the lookup key. Subscriptions already sold keep the old price.
  const productId = current
    ? String(current.product)
    : (
        await call("POST", "/v1/products", {
          name: plan.name,
          ...(plan.taxCode ? { tax_code: plan.taxCode } : {}),
          metadata: { product },
        })
      ).id;
  await call("POST", "/v1/prices", {
    product: productId,
    currency: plan.currency,
    unit_amount: plan.amount,
    tax_behavior: "exclusive",
    lookup_key: plan.lookupKey,
    ...(current ? { transfer_lookup_key: true } : {}),
    ...(plan.interval ? { recurring: { interval: plan.interval } } : {}),
  });
  return { lookupKey: plan.lookupKey, status: current ? "repriced" : "created" };
}

async function ensurePortal(call: StripeCall, catalogue: Catalogue): Promise<SetupResult["portal"]> {
  const configs = await call("GET", "/v1/billing_portal/configurations", { limit: 100 });
  if (
    configs.data.some(
      (c: { active: boolean; metadata?: { product?: string } }) =>
        c.active && c.metadata?.product === catalogue.product,
    )
  )
    return "exists";
  await call("POST", "/v1/billing_portal/configurations", {
    business_profile: { headline: catalogue.portal.headline },
    metadata: { product: catalogue.product },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "tax_id"] },
      subscription_cancel: { enabled: true, mode: catalogue.portal.cancel },
    },
  });
  return "created";
}

/** The webhook endpoint: made with the events the adapter translates, or updated when an older one lacks some. */
async function ensureWebhook(
  call: StripeCall,
  product: string,
  url: string,
): Promise<NonNullable<SetupResult["webhook"]>> {
  const list = await call("GET", "/v1/webhook_endpoints", { limit: 100 });
  const found = list.data.find((w: { url: string }) => w.url === url) as
    { id: string; enabled_events: string[] } | undefined;
  if (!found) {
    const created = await call("POST", "/v1/webhook_endpoints", {
      url,
      enabled_events: WEBHOOK_EVENTS,
      description: `${product} payments`,
    });
    return { status: "created", secret: created.secret };
  }
  const missing = WEBHOOK_EVENTS.filter(
    (e) => !found.enabled_events.includes(e) && !found.enabled_events.includes("*"),
  );
  if (missing.length === 0) return { status: "exists" };
  await call("POST", `/v1/webhook_endpoints/${found.id}`, { enabled_events: [...found.enabled_events, ...missing] });
  return { status: "updated" };
}

const registrationLabel = (r: Registration) =>
  `${r.country}${r.country_options?.ca?.province_standard?.province ? `-${r.country_options.ca.province_standard.province}` : ""}:${r.status}`;

/** What the tax setup looks like, as a line to print; a failure to read it is a line too, never an error. */
async function describeTax(call: StripeCall): Promise<string> {
  try {
    const settings = await call("GET", "/v1/tax/settings");
    const regs = await call("GET", "/v1/tax/registrations", { status: "all", limit: 20 });
    const list = regs.data.map(registrationLabel).join(", ");
    return `status ${settings.status}; head office ${settings.head_office?.address?.country ?? "missing"}; registrations: ${list || "none"}`;
  } catch (e) {
    return `not readable (${(e as Error).message})`;
  }
}

/**
 * Creates, idempotently, what the adapter reads as DATA: products and prices (found by lookup key), the customer-portal
 * configuration and, when asked, the webhook endpoint (its signing secret is returned once — the caller stores it).
 * Test or live is decided by the key; live is refused unless `owner` is true.
 */
export async function ensureCatalogue(call: StripeCall, catalogue: Catalogue, options: Options): Promise<SetupResult> {
  if (options.mode === "live" && !options.owner) throw new Error("Live mode is the owner's: refusing");
  const prices: SetupResult["prices"] = [];
  for (const plan of catalogue.plans) prices.push(await ensurePrice(call, catalogue.product, plan));
  const portal = await ensurePortal(call, catalogue);
  const webhook = options.webhookUrl ? await ensureWebhook(call, catalogue.product, options.webhookUrl) : undefined;
  return { prices, portal, webhook, tax: await describeTax(call) };
}

/** The part of a settings price entry (`@krizaka/settings`' `PriceEntry`) that the catalogue needs: structural, so `payments` does not import `settings`. */
export interface PriceEntryLike {
  key: string;
  plan: string;
  unit: string;
  amountCents: number | null;
  currency: string;
  availability: string;
}

/**
 * The plans to create at the processor, from the product's price catalogue (ADR-009: prices are data, read through settings).
 * Only entries on sale with a figure and a billing unit the processor knows (`month`, `year`, `once`) become plans; an entry on quote,
 * internal, in preparation or in another unit is left out. The lookup key is the entry's key (`yomizaka.pro`).
 * @param entries the catalogue as of now (`priceCatalogue(...).catalogue(clock.now())`)
 * @param names the display name per entry key (a message of the product)
 * @param taxCode the processor's tax code of the products
 */
export function plansFromPrices(
  entries: readonly PriceEntryLike[],
  names: Readonly<Record<string, string>>,
  taxCode?: string,
): CataloguePlan[] {
  const onSale = new Set(["public", "founder-limited"]);
  const interval: Record<string, CataloguePlan["interval"]> = { month: "month", year: "year", once: undefined };
  return entries
    .filter((e) => e.amountCents !== null && onSale.has(e.availability) && e.unit in interval)
    .map((e) => ({
      lookupKey: e.key,
      name: names[e.key] ?? e.plan,
      amount: e.amountCents!,
      currency: e.currency.toLowerCase(),
      ...(interval[e.unit] ? { interval: interval[e.unit] } : {}),
      ...(taxCode ? { taxCode } : {}),
    }));
}
