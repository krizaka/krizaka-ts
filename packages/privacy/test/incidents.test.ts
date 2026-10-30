import { describe, expect, it } from "vitest";

import {
  createIncidentRegister,
  type IncidentActor,
  IncidentError,
  memoryIncidentStore,
  registerToCsv,
  retainUntil,
  suggestSeriousInjury,
} from "../src";
import { incidentStoreContract } from "../src/testkit";

incidentStoreContract("memory incident store", () => memoryIncidentStore());

const ACTOR: IncidentActor = { id: "admin-1", label: "Admin" };
const NOW = new Date("2026-10-27T12:00:00.000Z");
const query = (async () => []) as never;

function setup() {
  let now = NOW;
  const store = memoryIncidentStore();
  const audited: { action: string; detail?: Record<string, unknown> }[] = [];
  const register = createIncidentRegister({
    clock: { now: () => now },
    storeFor: () => store,
    audit: { record: async (_q, e) => void audited.push(e) },
  });
  return { register, audited, tick: (ms: number) => void (now = new Date(now.valueOf() + ms)) };
}
const input = {
  scope: "t1",
  kind: "access",
  description: "A staff account opened a lease.",
  information: ["lease"],
  personsConcerned: 2,
} as const;
const serious = {
  sensitivity: "high",
  consequences: "high",
  likelihood: "high",
  seriousInjury: true,
  rationale: "Leases are sensitive.",
} as const;
const code = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as IncidentError).code;

describe("the incident register", () => {
  it("opens an entry kept five years from the day the enterprise became aware", async () => {
    const { register, audited } = setup();
    const aware = new Date("2026-10-20T09:00:00.000Z");
    const i = await register.open(query, { ...input, awareAt: aware }, ACTOR);
    expect(i).toMatchObject({ status: "open", drill: false, openedBy: "Admin" });
    expect(i.retainUntil.toISOString()).toBe("2031-10-20T09:00:00.000Z");
    expect(retainUntil(new Date("2024-02-29T00:00:00Z")).toISOString()).toBe("2029-03-01T00:00:00.000Z");
    expect(audited[0]).toMatchObject({ action: "privacy.incident_opened", detail: { scope: "t1" } });
    expect(JSON.stringify(audited)).not.toContain("lease");
  });

  it("refuses a badly formed entry", async () => {
    const { register } = setup();
    for (const bad of [
      { ...input, description: " " },
      { ...input, information: [] },
      { ...input, scope: "" },
      { ...input, personsConcerned: -1 },
      { ...input, awareAt: new Date(NOW.valueOf() + 1000) },
      { ...input, kind: "oops" as never },
    ])
      expect(await code(register.open(query, bad, ACTOR))).toBe("INCIDENT_BAD_INPUT");
  });

  it("runs a serious incident end to end: assess, notify both, close", async () => {
    const { register, tick } = setup();
    const { id } = await register.open(query, input, ACTOR);
    expect(await code(register.close(query, "t1", id, ACTOR))).toBe("INCIDENT_NOT_ASSESSED");
    expect(await code(register.recordNotice(query, "t1", id, "cai", { channel: "form" }, ACTOR))).toBe(
      "INCIDENT_NOT_ASSESSED",
    );
    tick(1000);
    await register.recordMeasure(query, "t1", id, "Session revoked.", ACTOR);
    const assessed = await register.assess(query, "t1", id, serious, ACTOR);
    expect(assessed).toMatchObject({ status: "assessed", assessment: { seriousInjury: true, assessedBy: "Admin" } });
    await register.recordNotice(query, "t1", id, "cai", { channel: "form", reference: "CAI-9" }, ACTOR);
    expect(await code(register.close(query, "t1", id, ACTOR))).toBe("INCIDENT_NOTICES_MISSING");
    tick(1000);
    await register.recordNotice(query, "t1", id, "persons", { channel: "email" }, ACTOR);
    const closed = await register.close(query, "t1", id, ACTOR);
    expect(closed).toMatchObject({
      status: "closed",
      caiNotice: { reference: "CAI-9" },
      personsNotice: { channel: "email" },
    });
    expect(closed.closedAt?.toISOString()).toBe("2026-10-27T12:00:02.000Z");
    expect(closed.measures).toHaveLength(1);
    expect(await code(register.recordMeasure(query, "t1", id, "late", ACTOR))).toBe("INCIDENT_CLOSED");
  });

  it("closes an incident without serious injury and refuses a notice nobody owes", async () => {
    const { register } = setup();
    const { id } = await register.open(query, input, ACTOR);
    await register.assess(
      query,
      "t1",
      id,
      {
        sensitivity: "low",
        consequences: "low",
        likelihood: "low",
        seriousInjury: false,
        rationale: "Nothing left the house.",
      },
      ACTOR,
    );
    expect(await code(register.recordNotice(query, "t1", id, "persons", { channel: "email" }, ACTOR))).toBe(
      "INCIDENT_NO_NOTICE_DUE",
    );
    expect((await register.close(query, "t1", id, ACTOR)).status).toBe("closed");
  });

  it("lets the assessment be redone until it is closed, and a drill be marked", async () => {
    const { register } = setup();
    const { id } = await register.open(query, input, ACTOR);
    await register.assess(query, "t1", id, serious, ACTOR);
    const again = await register.assess(
      query,
      "t1",
      id,
      { ...serious, seriousInjury: false, rationale: "Revised." },
      ACTOR,
    );
    expect(again.assessment?.rationale).toBe("Revised.");
    expect((await register.markDrill(query, "t1", id, true, ACTOR)).drill).toBe(true);
  });

  it("keeps tenants apart: another scope finds nothing and changes nothing", async () => {
    const { register } = setup();
    const { id } = await register.open(query, input, ACTOR);
    await register.open(query, { ...input, scope: "t2" }, ACTOR);
    expect(await register.get(query, "t2", id)).toBeNull();
    expect(await code(register.assess(query, "t2", id, serious, ACTOR))).toBe("INCIDENT_UNKNOWN");
    expect(await code(register.close(query, "t2", id, ACTOR))).toBe("INCIDENT_UNKNOWN");
    expect((await register.list(query, "t1")).map((i) => i.id)).toEqual([id]);
    const document = await register.exportRegister(query, "t2");
    expect(document).toMatchObject({ format: 1, scope: "t2", generatedAt: NOW.toISOString() });
    expect(document.entries).toHaveLength(1);
  });

  it("exports the register as CSV and neutralises spreadsheet formulas", async () => {
    const { register } = setup();
    await register.open(query, { ...input, description: '=HYPERLINK("x"), "quoted"' }, ACTOR);
    const csv = registerToCsv(await register.list(query, "t1"));
    const [head, row] = csv.trim().split("\r\n");
    expect(head!.startsWith("id,kind,aware_at")).toBe(true);
    expect(row).toContain(`"'=HYPERLINK(""x""), ""quoted"""`);
  });

  it("suggests, never decides: sensitive and likely is serious, harmless is not", () => {
    expect(suggestSeriousInjury({ sensitivity: "high", consequences: "low", likelihood: "medium" })).toBe(true);
    expect(suggestSeriousInjury({ sensitivity: "medium", consequences: "high", likelihood: "high" })).toBe(true);
    expect(suggestSeriousInjury({ sensitivity: "low", consequences: "high", likelihood: "high" })).toBe(true);
    expect(suggestSeriousInjury({ sensitivity: "high", consequences: "high", likelihood: "low" })).toBe(false);
    expect(suggestSeriousInjury({ sensitivity: "low", consequences: "low", likelihood: "low" })).toBe(false);
  });
});
