import type { Browser, Page } from "playwright-core";

export interface Size {
  width: number;
  height: number;
}
export const VIEWPORTS: Readonly<{ desktop: Size; phone: Size }>;
export const VISUAL_THEMES: readonly ["light", "dark"];
export const FROZEN_TIME: string;
export const VISUAL_LOCALE: string;
export const VISUAL_TIME_ZONE: string;
export const FREEZE_CSS: string;
export interface Journey {
  name: string;
  path: string | ((page: Page, o: { origin: string }) => Promise<string>);
  session?: boolean;
  mask?: string[];
  viewports?: string[];
  ready?: string | ((page: Page) => Promise<unknown>);
  firstPaint?: true | { hold: string[] };
}
export interface Cell {
  viewport: string;
  size: Size;
  theme: string;
  snapshot: string;
}
export function visualMatrix(
  journey: Journey,
  options?: { viewports?: Record<string, Size>; themes?: readonly string[] },
): Cell[];
export function visualContextOptions(o: {
  size: Size;
  theme: string;
  javaScript?: boolean;
  storageState?: unknown;
}): Record<string, unknown>;
export function initVisualPage(o: { theme: string; themeKey: string }): void;
export function prepareVisualPage(page: Page, o?: { theme?: string; themeKey?: string; now?: string }): Promise<void>;
export function settleForShot(page: Page, o?: { javaScript?: boolean }): Promise<void>;
export function shotOptions(o?: { mask?: string[]; page?: Page }): Record<string, unknown>;
export function defineJourneyTests(o: {
  test: unknown;
  expect: unknown;
  journeys: Journey[];
  signIn: (page: Page, o: { base?: string }) => Promise<void>;
  base?: string;
  viewports?: Record<string, Size>;
  themes?: readonly string[];
  themeKey?: string;
  now?: string;
}): void;
export type { Browser };
