import { beforeAll, describe, expect, it } from "vitest";

import {
  AVAILABILITY,
  definePrices,
  describePrices,
  findTypedPrices,
  memoryPriceStore,
  priceCatalogue,
  PriceError,
  pricesMigration,
  type PriceStore,
  priceStore,
  publicCatalogue,
  UNIT,
} from "../src";
import { databaseEnabled, testDatabase } from "./database";

/** A seed the way a product writes it: its current pricing module, now the catalogue's defaults. */
const prices = definePrices([
  { product: "yomizaka", plan: "document", unit: UNIT.document, amountCents: 65, availability: AVAILABILITY.public },
  {
    product: "yomizaka",
    plan: "agency",
    unit: UNIT.month,
    amountCents: 5900,
    availability: AVAILABILITY.public,
    limits: { included: 100, overageCents: 45 },
  },
  { product: "yomizaka", plan: "api", unit: UNIT.document, amountCents: null, availability: AVAILABILITY.internal },
  {
    product: "akinaza",
    plan: "starter",
    unit: UNIT.month,
    amountCents: 4500,
    availability: AVAILABILITY.founderLimited,
    limits: { founderCap: 20, cardFeeBps: 0 },
  },
  {
    product: "akinaza",
    plan: "scale",
    unit: UNIT.month,
    amountCents: 9900,
    availability: AVAILABILITY.preparing,
    limits: { directDebitBps: 25, directDebitCapCents: 1000 },
  },
]);

const ADMIN = { id: null, label: "admin@test.example" };
const T0 = new Date("2026-10-25T12:00:00Z");
const LATER = new Date("2026-11-01T00:00:00Z");

describe("the catalogue's seed", () => {
  it("keys every entry product.plan, in CAD, before taxes", () => {
    expect(prices.keys).toEqual([
      "yomizaka.document",
      "yomizaka.agency",
      "yomizaka.api",
      "akinaza.starter",
      "akinaza.scale",
    ]);
    expect(prices.defaultOf("yomizaka.agency")).toMatchObject({
      currency: "CAD",
      taxes: "plus-taxes",
      amountCents: 5900,
      limits: { included: 100, overageCents: 45 },
    });
    expect(prices.defaultOf("yomizaka.document").limits).toEqual({});
    expect(prices.isKey("yomizaka.agency")).toBe(true);
    expect(prices.isKey("toString")).toBe(false);
  });
  it.each([
    [
      "a duplicate key",
      [
        { product: "a", plan: "b", unit: UNIT.month, amountCents: 1, availability: AVAILABILITY.public },
        { product: "a", plan: "b", unit: UNIT.month, amountCents: 2, availability: AVAILABILITY.public },
      ],
    ],
    [
      "a negative amount",
      [{ product: "a", plan: "b", unit: UNIT.month, amountCents: -1, availability: AVAILABILITY.public }],
    ],
    [
      "a fraction of a cent",
      [{ product: "a", plan: "b", unit: UNIT.month, amountCents: 1.5, availability: AVAILABILITY.public }],
    ],
    ["an unknown unit", [{ product: "a", plan: "b", unit: "week", amountCents: 1, availability: AVAILABILITY.public }]],
    [
      "a bad plan id",
      [{ product: "a", plan: "B c", unit: UNIT.month, amountCents: 1, availability: AVAILABILITY.public }],
    ],
    [
      "a public entry without a figure",
      [{ product: "a", plan: "b", unit: UNIT.month, amountCents: null, availability: AVAILABILITY.public }],
    ],
  ])("refuses %s", (_name, seed) => expect(() => definePrices(seed as never)).toThrow(PriceError));
});

describe("what a public page may show", () => {
  const entries = prices.keys.map((k) => ({
    key: k,
    product: k.split(".")[0]!,
    plan: k.split(".")[1]!,
    versionId: `seed:${k}`,
    effectiveFrom: new Date(0),
    ...prices.defaultOf(k),
  }));
  const shown = publicCatalogue(entries);
  it("never an internal entry", () =>
    expect(shown.map((p) => p.key)).toEqual([
      "yomizaka.document",
      "yomizaka.agency",
      "akinaza.starter",
      "akinaza.scale",
    ]));
  it("an entry in preparation, without its figure or its limits", () =>
    expect(shown.find((p) => p.key === "akinaza.scale")).toMatchObject({
      availability: "preparing",
      amountCents: null,
      limits: {},
    }));
  it("public and founder-limited entries with their figure, the version they were read at", () => {
    expect(shown.find((p) => p.key === "akinaza.starter")).toMatchObject({
      amountCents: 4500,
      limits: { founderCap: 20 },
      versionId: "seed:akinaza.starter",
      taxes: "plus-taxes",
    });
  });
});

describe("a price typed in a message", () => {
  it.each(["9,99 $ par vérification", "Pro: $49 a month", "49 $", "0.65 CAD", "à partir de 1 550,00 $", "29$"])(
    "is found: %s",
    (text) => expect(findTypedPrices({ a: { b: text } })).toEqual(["a.b"]),
  );
  it.each([
    "{price} par vérification",
    "100 vérifications par mois",
    "0 % sur les cartes",
    "Loi 25",
    "plus taxes",
    "9-8-8",
  ])("is not a price: %s", (text) => expect(findTypedPrices({ a: [text] })).toEqual([]));
  it("names every path, arrays included", () =>
    expect(findTypedPrices({ x: ["ok", "45 $"], y: { z: "99 $" } })).toEqual(["x.1", "y.z"]));
});

/** The contract every store runs: the memory one here, the persistence one against PostgreSQL. */
function contract(name: string, makeStore: () => Promise<PriceStore>) {
  describe(`the catalogue over ${name}`, () => {
    let store: PriceStore;
    beforeAll(async () => {
      store = await makeStore();
    });
    const catalogue = () => priceCatalogue(prices, store);

    it("serves the seed until an administrator changes something", async () => {
      const e = await catalogue().entry("yomizaka.agency", T0);
      expect(e).toMatchObject({ key: "yomizaka.agency", amountCents: 5900, versionId: "seed:yomizaka.agency" });
      expect((await catalogue().catalogue(T0)).map((x) => x.key)).toEqual(prices.keys);
    });

    it("a change takes effect at its date, and never rewrites what was sold before it", async () => {
      const sold = await catalogue().entry("yomizaka.agency", T0);
      const v = await catalogue().schedule(
        ADMIN,
        "yomizaka.agency",
        { amountCents: 6900, limits: { included: 120, overageCents: 45 } },
        LATER,
        T0,
      );
      expect(v).toMatchObject({
        key: "yomizaka.agency",
        amountCents: 6900,
        effectiveFrom: LATER,
        availability: "public",
      });
      expect((await catalogue().entry("yomizaka.agency", T0)).amountCents).toBe(5900);
      expect((await catalogue().entry("yomizaka.agency", LATER)).amountCents).toBe(6900);
      expect(await catalogue().version(sold.versionId)).toMatchObject({ amountCents: 5900 });
      expect(await catalogue().version(v.versionId)).toMatchObject({ amountCents: 6900, limits: { included: 120 } });
    });

    it("the last change scheduled for the same date wins", async () => {
      await catalogue().schedule(ADMIN, "akinaza.starter", { amountCents: 3900 }, LATER, T0);
      await catalogue().schedule(
        ADMIN,
        "akinaza.starter",
        { amountCents: 4500, limits: { founderCap: 30, cardFeeBps: 0 } },
        LATER,
        T0,
      );
      expect(await catalogue().entry("akinaza.starter", LATER)).toMatchObject({
        amountCents: 4500,
        limits: { founderCap: 30 },
      });
    });

    it("keeps who changed what, when, before, after and from when — newest first", async () => {
      const h = await catalogue().history("yomizaka.agency");
      expect(h[0]).toMatchObject({
        actorLabel: "admin@test.example",
        before: { amountCents: 5900 },
        after: { amountCents: 6900 },
        effectiveFrom: LATER.toISOString(),
      });
      expect(h.at(-1)).toMatchObject({ versionId: "seed:yomizaka.agency", actorLabel: "seed" });
    });

    it.each([
      ["an unknown key", "nothing.here", { amountCents: 1 }, LATER, 404, "UNKNOWN_PRICE"],
      [
        "a date in the past",
        "yomizaka.document",
        { amountCents: 70 },
        new Date("2026-10-01T00:00:00Z"),
        400,
        "BAD_DATE",
      ],
      ["a bad amount", "yomizaka.document", { amountCents: -5 }, LATER, 400, "BAD_VALUE"],
      ["a currency other than CAD", "yomizaka.document", { currency: "USD" }, LATER, 400, "BAD_VALUE"],
    ])("refuses %s, and writes nothing", async (_n, key, change, at, status, code) => {
      const before = (await catalogue().history("yomizaka.document")).length;
      await expect(catalogue().schedule(ADMIN, key, change as never, at, T0)).rejects.toMatchObject({ status, code });
      expect((await catalogue().history("yomizaka.document")).length).toBe(before);
    });

    it("an unknown version is null, never another price", async () =>
      expect(await catalogue().version("999999")).toBeNull());

    it("describes itself JSON-safe for the admin screen", async () => {
      const d = await describePrices(catalogue(), T0);
      expect(JSON.parse(JSON.stringify(d))).toEqual(d);
      expect(d.units).toContain("month");
      expect(d.availabilities).toEqual(["public", "internal", "founder-limited", "preparing"]);
      expect(d.entries.find((x) => x.key === "yomizaka.agency")).toMatchObject({
        amountCents: 5900,
        effectiveFrom: new Date(0).toISOString(),
        upcoming: [{ amountCents: 6900, effectiveFrom: LATER.toISOString() }],
      });
    });
  });
}

contract("memory", async () => memoryPriceStore());

describe.runIf(databaseEnabled)("persistence", () => {
  const query = testDatabase("prices", pricesMigration());
  contract("PostgreSQL", async () => priceStore({ query }));
  it("each change also leaves its line in the settings' audit", async () => {
    const rows = await query<{ key: string }>("SELECT key FROM settings_audit WHERE key LIKE 'price.%'");
    expect(rows.length).toBeGreaterThan(0);
  });
});
