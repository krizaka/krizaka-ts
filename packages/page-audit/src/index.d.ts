/* Minimal structural types: playwright-core is a peer dependency, not imported here. */
export type Page = Record<string, unknown>;
export type BrowserContext = Record<string, unknown>;
export type Browser = { newContext(o?: object): Promise<BrowserContext>; close(): Promise<void> };
export const auditPage: string;
export interface ProblemChecks { errors?: string[]; h1?: boolean; headerAction?: boolean; fileLabels?: boolean }
export function problemsOf(where: string, result: Record<string, unknown>, checks?: ProblemChecks): string[];
export function auditOptions<T extends object>(options?: T): T & { reducedMotion: "reduce" };
export function withoutViewTransitions(): void;
export function auditContext(browser: { newContext(o?: object): Promise<BrowserContext> }, options?: object): Promise<BrowserContext>;
export function settled(page: Page): Promise<unknown>;
export function loadSettled(page: Page, url: string, options?: object): Promise<BrowserContext>;
export function resizeSettled(page: Page, size: { width: number; height: number }): Promise<void>;
export const WIDTHS: number[];
export const THEMES: string[];
export function isPageError(message: { type(): string; text(): string }): boolean;
export interface AuditRoutesOptions {
  base: string; routes: string[]; widths?: number[]; themes?: string[]; height?: number; themeKey?: string; shots?: string; settleMs?: number;
  checks?: Omit<ProblemChecks, "errors">; prepare?: (page: Page, route: string) => Promise<void>; launch?: () => Promise<BrowserContext>;
}
export function auditRoutes(options: AuditRoutesOptions): Promise<string[]>;
export function selfTest(options?: { launch?: () => Promise<BrowserContext> }): Promise<string[]>;
