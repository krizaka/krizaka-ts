export type Platform = "web" | "mobile";

/** A row of `journeys/journeys.json` (ADR-017 §3). */
export interface JourneyRow {
  id: string;
  promise: string;
  persona: string;
  platforms: Platform[];
  steps: string[];
  video?: boolean;
  budgetSeconds?: number;
  tags?: string[];
}

export const DEFAULT_BUDGET_SECONDS: 90;
export function validateJourney(journey: Partial<JourneyRow>, options?: { cast?: readonly string[] }): string[];
export function checkCatalogue(input: { files: readonly string[]; index: readonly { id: string }[] }): string[];
export function journeysByTag<T extends { tags?: string[] }>(index: readonly T[], tag: string): T[];
export function budgetProblem(journey: Pick<JourneyRow, "id" | "budgetSeconds">, elapsedMs: number): string | undefined;

export interface PersonaSessions {
  /** The path of the persona's browser state for this worker; signs in on the first call only. */
  stateFor(persona: string): Promise<string>;
}
export function personaSessions(options: {
  dir: string;
  signIn: (persona: string, file: string) => Promise<unknown>;
  worker?: number;
}): PersonaSessions;

export function seededPersona<T>(cast: Record<string, T>, id: string): T;

export const JOURNEY_MASKS: readonly string[];
export function journeyMaskSelectors(options?: { extra?: readonly string[]; defaults?: boolean }): string[];

export const VIDEO_SIZE: Readonly<{ width: number; height: number }>;
export function videoContextOptions(
  journey: Pick<JourneyRow, "id" | "video">,
  options: { dir: string; size?: { width: number; height: number } },
): { recordVideo?: { dir: string; size: { width: number; height: number } } };
export function videoFile(journey: Pick<JourneyRow, "id">, platform: Platform): string;

export function assertNoRetries(config: { retries?: number; projects?: { name?: string; retries?: number }[] }): void;

export const QUARANTINE_CAP: 1;
export interface QuarantineEntry {
  test: string;
  reason: string;
  issue: string;
}
export function quarantine(
  entries: readonly QuarantineEntry[],
  options?: { max?: number },
): { entries: readonly QuarantineEntry[]; has(title: string): boolean };
