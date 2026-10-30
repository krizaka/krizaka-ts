import { createHash } from "node:crypto";

import {
  type CategoryDefaults,
  type Channel,
  CHANNELS,
  NOTIFICATION_CODE,
  type NotificationConfig,
  NotificationError,
} from "./port";

export const NOTIFICATION_BOUNDS = {
  burstMax: [1, 1000],
  burstWindowSeconds: [1, 604_800],
  retentionDays: [1, 3650],
} as const;
export const NOTIFICATION_DEFAULTS = { burstMax: 20, burstWindowSeconds: 3600, retentionDays: 180 } as const;

/** A category name: a camel-case word (it becomes part of a setting key). */
export const CATEGORY_NAME = /^[a-z][a-zA-Z0-9]{0,39}$/;
const TEMPLATE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
// @fixed: a notification is a short event, not a document; a bigger payload belongs in the product's own tables
const MAX_PAYLOAD_BYTES = 8192;
const MAX_KEY = 200;

/** A stable UUID (version 5 shaped) from a seed: the same fact appended twice is one outbox message. */
export function uuidOf(seed: string): string {
  const h = createHash("sha256").update(`krizaka.notifications:${seed}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const within = (n: number, [min, max]: readonly [number, number]) => Number.isInteger(n) && n >= min && n <= max;

/** @throws NotificationError when a category name, a burst cap or the retention is out of bounds. */
export function checkConfig(config: NotificationConfig): NotificationConfig {
  for (const [name, c] of Object.entries(config.categories)) {
    if (!CATEGORY_NAME.test(name))
      throw new NotificationError(NOTIFICATION_CODE.badConfig, `category « ${name} » must be a camel-case word`);
    if (!within(c.burstMax, NOTIFICATION_BOUNDS.burstMax))
      throw new NotificationError(NOTIFICATION_CODE.badConfig, `${name}.burstMax is out of bounds`);
    if (!within(c.burstWindowSeconds, NOTIFICATION_BOUNDS.burstWindowSeconds))
      throw new NotificationError(NOTIFICATION_CODE.badConfig, `${name}.burstWindowSeconds is out of bounds`);
  }
  if (!within(config.retentionDays, NOTIFICATION_BOUNDS.retentionDays))
    throw new NotificationError(NOTIFICATION_CODE.badConfig, "retentionDays is out of bounds");
  return config;
}

export function categoryOf(config: NotificationConfig, name: string): CategoryDefaults {
  const category = Object.hasOwn(config.categories, name) ? config.categories[name] : undefined;
  if (!category) throw new NotificationError(NOTIFICATION_CODE.badCategory, `unknown category « ${name} »`);
  return category;
}

/** The channels on for an account: the category's defaults, overridden by the account's choices, unless the category is locked. */
export function resolveChannels(
  category: CategoryDefaults,
  chosen: ReadonlyMap<Channel, boolean>,
): Record<Channel, boolean> {
  const out = { ...category.defaults };
  if (category.locked) return out;
  for (const channel of CHANNELS) {
    const choice = chosen.get(channel);
    if (choice !== undefined) out[channel] = choice;
  }
  return out;
}

/** What an account sees in its settings: every category, every channel, and why. */
export interface PreferenceView {
  category: string;
  locked: boolean;
  channels: Record<Channel, { enabled: boolean; source: "default" | "account" | "locked" }>;
}

export function viewOf(
  config: NotificationConfig,
  rows: readonly { category: string; channel: Channel; enabled: boolean }[],
): PreferenceView[] {
  return Object.entries(config.categories).map(([category, def]) => {
    const chosen = new Map(rows.filter((r) => r.category === category).map((r) => [r.channel, r.enabled] as const));
    const channels = Object.fromEntries(
      CHANNELS.map((channel) => {
        const source = def.locked ? "locked" : chosen.has(channel) ? "account" : "default";
        return [
          channel,
          { enabled: def.locked ? def.defaults[channel] : (chosen.get(channel) ?? def.defaults[channel]), source },
        ];
      }),
    ) as PreferenceView["channels"];
    return { category, locked: def.locked, channels };
  });
}

export interface NotifyInput {
  accountId: string;
  category: string;
  /** The template the e-mail and the push are rendered from (`new-follower`): lower-case words joined by hyphens. */
  template: string;
  /** The words' variables: strings only, the shape of Java's `NotificationRequest`. Never a secret. */
  variables?: Record<string, string>;
  /** The recipient's language; only the language is used. */
  locale?: string;
  /** Where e-mail goes. Without it the e-mail channel is skipped (the product resolves the address, this module holds none). */
  email?: string;
  /** What the bell shows besides the template and variables (a link, an actor id): JSON, small. */
  payload?: Record<string, unknown>;
  /** One event notified twice is one notification: the same key for the same fact. */
  dedupeKey?: string;
}

const NOT_IN_ADDRESS = /[\s<>]/;

/** One `@`, a local part, and a domain of dot-separated non-empty parts: no backtracking pattern over library input. */
function isAddress(value: string): boolean {
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@") || NOT_IN_ADDRESS.test(value)) return false;
  const labels = value.slice(at + 1).split(".");
  return labels.length >= 2 && labels.every((label) => label !== "");
}

/** @throws NotificationError on the first thing wrong with an input. */
export function checkInput(input: NotifyInput): void {
  const bad = (why: string) => new NotificationError(NOTIFICATION_CODE.badInput, why);
  if (typeof input.accountId !== "string" || input.accountId === "") throw bad("accountId is required");
  if (!TEMPLATE.test(input.template)) throw bad("template is lower-case words joined by hyphens");
  if (input.locale !== undefined && !LOCALE.test(input.locale)) throw bad("locale is a language tag like fr or en-CA");
  if (input.dedupeKey !== undefined && (input.dedupeKey === "" || input.dedupeKey.length > MAX_KEY))
    throw bad("dedupeKey is 1 to 200 characters");
  if (input.email !== undefined && !isAddress(input.email)) throw bad("email is not an address");
  for (const [key, value] of Object.entries(input.variables ?? {}))
    if (typeof value !== "string") throw bad(`variable « ${key} » must be a string`);
  if (Buffer.byteLength(JSON.stringify({ v: input.variables ?? {}, p: input.payload ?? {} })) > MAX_PAYLOAD_BYTES)
    throw bad("variables and payload are too big for a notification");
}
