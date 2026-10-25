import type { KindConfig, StatusSet } from "../src";

/** Yomizaka's decision on an applicant file (demo data): à décider → retenu | non retenu, both final, refusing asks twice. */
export const DECISION: StatusSet = {
  key: "decision",
  label: { fr: "Décision", en: "Decision" },
  mode: "editable",
  states: [
    { key: "a_decider", label: { fr: "À décider", en: "To decide" }, tone: "neutral" },
    { key: "en_attente", label: { fr: "En attente", en: "On hold" }, tone: "warning" },
    { key: "retenu", label: { fr: "Retenu", en: "Selected" }, tone: "success", final: true },
    { key: "non_retenu", label: { fr: "Non retenu", en: "Not selected" }, tone: "danger", final: true },
  ],
  initial: "a_decider",
  transitions: [
    { from: "a_decider", to: "en_attente", roles: ["owner", "manager"] },
    { from: "en_attente", to: "a_decider", roles: ["owner", "manager"] },
    { from: "a_decider", to: "retenu", roles: ["owner"] },
    { from: "en_attente", to: "retenu", roles: ["owner"] },
    { from: "a_decider", to: "non_retenu", roles: ["owner"], confirm: true, reasons: [{ key: "incomplet", label: { fr: "Dossier incomplet", en: "Incomplete file" } }] },
  ],
};

/** Akinaza's invoice state (demo data): computed from the ledger, never moved. */
export const INVOICE_STATE: StatusSet = {
  key: "invoice_state",
  label: { fr: "État", en: "State" },
  mode: "derived",
  states: [
    { key: "due", label: { fr: "À payer", en: "Due" }, tone: "neutral" },
    { key: "overdue", label: { fr: "En retard", en: "Overdue" }, tone: "danger" },
    { key: "paid", label: { fr: "Payée", en: "Paid" }, tone: "success" },
  ],
  transitions: [],
};

export const fileConfig = (over: Partial<KindConfig> = {}): KindConfig => ({
  kind: "file",
  tags: { writers: ["owner", "manager"], userTags: true, max: 5, presets: { default: [{ name: "Urgent", marker: "red" }, { name: "Garant", marker: "blue" }], coiffure: [{ name: "Fidèle", marker: "violet" }] } },
  status: DECISION,
  views: [{ key: "a_decider", label: { fr: "À décider", en: "To decide" }, filters: { status: ["a_decider"] } }],
  ...over,
});
