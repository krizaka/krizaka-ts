import {
  AVAILABILITY,
  type Availability,
  type Price,
  type PriceEntry,
  PriceError,
  priceSchema,
  type PricesDefinition,
  SEED_FROM,
  seedVersionId,
  UNIT,
  type Unit,
} from "./prices";
import type { Actor } from "./service";

/** A version an administrator scheduled: the price in force from `effectiveFrom`, and the one it replaced at that date. */
export interface StoredPriceVersion {
  id: string;
  key: string;
  price: Price;
  before: Price;
  effectiveFrom: Date;
  createdAt: Date;
  actorLabel: string;
}

/** Where the versions live (the product's database, or memory in tests). Versions are only ever added. */
export interface PriceStore {
  /** Every version of a key, oldest scheduled first. */
  versions(key: string): Promise<StoredPriceVersion[]>;
  version(id: string): Promise<StoredPriceVersion | null>;
  /** Adds a version and its audit line, atomically. */
  insert(version: Omit<StoredPriceVersion, "id">, actor: Actor): Promise<StoredPriceVersion>;
}

export interface PriceHistoryLine {
  versionId: string;
  at: string;
  actorLabel: string;
  effectiveFrom: string;
  before: Price | null;
  after: Price;
}

/** The catalogue a product reads and its administrator edits. */
export interface PriceCatalogue {
  /** The entry in force at a date (a page passes now; an invoice passes the subscription's date). */
  entry(key: string, at: Date): Promise<PriceEntry>;
  catalogue(at: Date): Promise<PriceEntry[]>;
  /** The version a subscription was sold at, forever; null for an id that is not one. */
  version(id: string): Promise<PriceEntry | null>;
  /** A change from a date (now or later, never the past): a new version over the one in force then. */
  schedule(actor: Actor, key: string, change: Partial<Price>, effectiveFrom: Date, now: Date): Promise<PriceEntry>;
  /** Every change of a key, newest first, ending with the seed. */
  history(key: string): Promise<PriceHistoryLine[]>;
  /** The versions scheduled after a date. */
  upcoming(key: string, at: Date): Promise<PriceEntry[]>;
}

const split = (key: string) => {
  const dot = key.indexOf(".");
  return { product: key.slice(0, dot), plan: key.slice(dot + 1) };
};
const toEntry = (key: string, price: Price, versionId: string, effectiveFrom: Date): PriceEntry => ({
  key,
  ...split(key),
  ...price,
  versionId,
  effectiveFrom,
});
const fromStored = (v: StoredPriceVersion) => toEntry(v.key, v.price, v.id, v.effectiveFrom);
/** In force at `at`: the latest date not after it; for the same date, the last scheduled. */
const inForce = (versions: StoredPriceVersion[], at: Date) =>
  versions
    .filter((v) => v.effectiveFrom <= at)
    .reduce<StoredPriceVersion | undefined>(
      (best, v) => (!best || v.effectiveFrom >= best.effectiveFrom ? v : best),
      undefined,
    );

export function priceCatalogue(prices: PricesDefinition, store: PriceStore): PriceCatalogue {
  const known = (key: string) => {
    if (!prices.isKey(key)) throw new PriceError(404, "UNKNOWN_PRICE", `No such price: ${key}`);
    return key;
  };
  async function entry(key: string, at: Date): Promise<PriceEntry> {
    const v = inForce(await store.versions(known(key)), at);
    return v ? fromStored(v) : toEntry(key, prices.defaultOf(key), seedVersionId(key), SEED_FROM);
  }
  return {
    entry,
    catalogue: (at) => Promise.all(prices.keys.map((k) => entry(k, at))),

    async version(id) {
      if (id.startsWith("seed:")) {
        const key = id.slice("seed:".length);
        return prices.isKey(key) ? toEntry(key, prices.defaultOf(key), id, SEED_FROM) : null;
      }
      const v = /^\d{1,18}$/.test(id) ? await store.version(id) : null;
      return v ? fromStored(v) : null;
    },

    async schedule(actor, key, change, effectiveFrom, now) {
      known(key);
      if (!(effectiveFrom instanceof Date) || Number.isNaN(effectiveFrom.getTime()) || effectiveFrom < now)
        throw new PriceError(400, "BAD_DATE", "A price changes from now or later, never in the past");
      const current = await entry(key, effectiveFrom);
      const { key: _k, product: _p, plan: _pl, versionId: _v, effectiveFrom: _e, ...before } = current;
      const parsed = priceSchema.safeParse({ ...before, ...change });
      if (!parsed.success) throw new PriceError(400, "BAD_VALUE", `Not a valid price for ${key}`);
      return fromStored(
        await store.insert(
          { key, price: parsed.data, before, effectiveFrom, createdAt: now, actorLabel: actor.label },
          actor,
        ),
      );
    },

    async history(key) {
      const versions = await store.versions(known(key));
      const lines = versions.map((v) => ({
        versionId: v.id,
        at: v.createdAt.toISOString(),
        actorLabel: v.actorLabel,
        effectiveFrom: v.effectiveFrom.toISOString(),
        before: v.before,
        after: v.price,
      }));
      const seed = {
        versionId: seedVersionId(key),
        at: SEED_FROM.toISOString(),
        actorLabel: "seed",
        effectiveFrom: SEED_FROM.toISOString(),
        before: null,
        after: prices.defaultOf(key),
      };
      return [...lines.reverse(), seed];
    },

    async upcoming(key, at) {
      return (await store.versions(known(key))).filter((v) => v.effectiveFrom > at).map(fromStored);
    },
  };
}

/** Versions in memory: for tests and for a product's first steps. */
export function memoryPriceStore(): PriceStore {
  const rows: StoredPriceVersion[] = [];
  return {
    versions: async (key) => rows.filter((r) => r.key === key),
    version: async (id) => rows.find((r) => r.id === id) ?? null,
    async insert(version) {
      const row = { ...version, id: String(rows.length + 1) };
      rows.push(row);
      return row;
    },
  };
}

/** The catalogue as the admin screen draws it: JSON-safe, with the enumerations its fields offer and what is already scheduled. */
export interface PricesDescription {
  units: Unit[];
  availabilities: Availability[];
  entries: (Omit<PriceEntry, "effectiveFrom"> & {
    effectiveFrom: string;
    upcoming: (Price & { versionId: string; effectiveFrom: string })[];
  })[];
}
export async function describePrices(catalogue: PriceCatalogue, at: Date): Promise<PricesDescription> {
  const iso = <T extends { effectiveFrom: Date }>(e: T) => ({ ...e, effectiveFrom: e.effectiveFrom.toISOString() });
  const entries = await Promise.all(
    (await catalogue.catalogue(at)).map(async (e) => ({
      ...iso(e),
      upcoming: (await catalogue.upcoming(e.key, at)).map(({ key: _k, product: _p, plan: _pl, ...v }) => iso(v)),
    })),
  );
  return { units: Object.values(UNIT), availabilities: Object.values(AVAILABILITY), entries };
}
