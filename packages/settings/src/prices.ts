import { z } from "zod";

/**
 * A product's prices as DATA (ADR-009, krizaka/.github#253): a typed catalogue of entries — product, plan, unit, amount, CAD, before
 * taxes, availability, named limits — whose seed is the product's former pricing module. An administrator changes an entry by
 * scheduling a new version from a date; a subscription keeps the version it was sold at. Public pages read the catalogue only.
 */
export const UNIT = {
  month: "month",
  year: "year",
  once: "once",
  document: "document",
  order: "order",
  pack: "pack",
  hour: "hour",
} as const;
export type Unit = (typeof UNIT)[keyof typeof UNIT];
const UNITS = Object.values(UNIT) as [Unit, ...Unit[]];

/** Who may see an entry: everyone with its figure, nobody outside, the first customers only (a cap in `limits`), or « en préparation » (no figure). */
export const AVAILABILITY = {
  public: "public",
  internal: "internal",
  founderLimited: "founder-limited",
  preparing: "preparing",
} as const;
export type Availability = (typeof AVAILABILITY)[keyof typeof AVAILABILITY];
const AVAILABILITIES = Object.values(AVAILABILITY) as [Availability, ...Availability[]];

const ID = /^[a-z][a-zA-Z0-9-]{0,39}$/;
const LIMIT = /^[a-z][a-zA-Z0-9]{0,39}$/;
// @fixed: a sanity bound on one price (one million dollars, in cents), not a business parameter
const MAX_CENTS = 100_000_000;

/** What a version of an entry holds. Every price is in Canadian dollars, shown before GST and QST (the processor adds them). */
export const priceSchema = z
  .object({
    unit: z.enum(UNITS),
    /** Integer cents; `null` is « on quote ». */
    amountCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
    currency: z.literal("CAD"),
    taxes: z.literal("plus-taxes"),
    availability: z.enum(AVAILABILITIES),
    /** Named integers the product reads: `included`, `overageCents`, `founderCap`, `feeBps`, `feeCapCents`… */
    limits: z.record(z.string().regex(LIMIT), z.number().int().min(0).max(MAX_CENTS)),
  })
  .strict()
  .refine(
    (p) =>
      p.amountCents !== null ||
      (p.availability !== AVAILABILITY.public && p.availability !== AVAILABILITY.founderLimited),
    { message: "An entry on sale has a figure" },
  );
export type Price = z.infer<typeof priceSchema>;

export interface PriceSeed {
  product: string;
  plan: string;
  unit: Unit;
  amountCents: number | null;
  availability: Availability;
  limits?: Record<string, number>;
}

/** An entry as read at a date: its key, the version in force and from when. */
export interface PriceEntry extends Price {
  key: string;
  product: string;
  plan: string;
  versionId: string;
  effectiveFrom: Date;
}

export class PriceError extends Error {
  constructor(
    readonly status: number,
    readonly code: "UNKNOWN_PRICE" | "BAD_VALUE" | "BAD_DATE",
    message: string,
  ) {
    super(message);
    this.name = "PriceError";
  }
}

/** The seed version of an entry: its id and the date it is in force from (always). */
export const seedVersionId = (key: string) => `seed:${key}`;
export const SEED_FROM = new Date(0);

/** The catalogue's definition: its keys and their defaults, each validated (a bad seed fails at start, never on a page). */
export function definePrices(seed: readonly PriceSeed[]) {
  const defaults = new Map<string, Price>();
  for (const s of seed) {
    if (!ID.test(s.product) || !ID.test(s.plan))
      throw new PriceError(400, "BAD_VALUE", `Not a product or plan id: ${s.product}.${s.plan}`);
    const key = `${s.product}.${s.plan}`;
    if (defaults.has(key)) throw new PriceError(400, "BAD_VALUE", `Twice in the seed: ${key}`);
    const parsed = priceSchema.safeParse({
      unit: s.unit,
      amountCents: s.amountCents,
      currency: "CAD",
      taxes: "plus-taxes",
      availability: s.availability,
      limits: s.limits ?? {},
    });
    if (!parsed.success) throw new PriceError(400, "BAD_VALUE", `Not a valid price for ${key}`);
    defaults.set(key, parsed.data);
  }
  const keys = [...defaults.keys()];
  const isKey = (key: string) => defaults.has(key);
  const defaultOf = (key: string): Price => {
    const d = defaults.get(key);
    if (!d) throw new PriceError(404, "UNKNOWN_PRICE", `No such price: ${key}`);
    return d;
  };
  return { keys, isKey, defaultOf };
}
export type PricesDefinition = ReturnType<typeof definePrices>;

/** What a public page shows: never an internal entry; an entry in preparation without its figure or its limits. */
export interface PublicPrice extends Omit<PriceEntry, "effectiveFrom"> {
  effectiveFrom: string;
}
export const publicCatalogue = (entries: readonly PriceEntry[]): PublicPrice[] =>
  entries
    .filter((e) => e.availability !== AVAILABILITY.internal)
    .map((e) => ({
      ...e,
      effectiveFrom: e.effectiveFrom.toISOString(),
      ...(e.availability === AVAILABILITY.preparing ? { amountCents: null, limits: {} } : {}),
    }));

/** An amount with a currency sign or code, before or after it (French and English writing, any thousands separator). */
const TYPED_PRICE = /\d(?:[\d\s\u00a0\u202f.,]*\d)?\s?(?:\$|CAD\b|USD\b|€)|\$\s?\d/u;

/** The paths of every message that types an amount — a product's « every price comes from the catalogue » test fails on any. */
export function findTypedPrices(messages: unknown, path: string[] = []): string[] {
  if (typeof messages === "string") return TYPED_PRICE.test(messages) ? [path.join(".")] : [];
  if (Array.isArray(messages)) return messages.flatMap((m, i) => findTypedPrices(m, [...path, String(i)]));
  if (messages && typeof messages === "object")
    return Object.entries(messages).flatMap(([k, v]) => findTypedPrices(v, [...path, k]));
  return [];
}
