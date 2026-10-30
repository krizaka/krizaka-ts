/* Minimal structural types: playwright-core is a peer dependency, not imported here. */
export type Page = Record<string, unknown>;
export type BrowserContext = Record<string, unknown>;
export type Browser = { newContext(o?: object): Promise<BrowserContext>; close(): Promise<void> };
export const auditPage: string;
export type Chrome = "public" | "app" | "auth";
export interface ProblemChecks {
  errors?: string[];
  h1?: boolean;
  headerAction?: boolean;
  fileLabels?: boolean;
  /** HTTP status of the load (`null`: no response); a 4xx/5xx is a problem. */
  status?: number | null;
  emptyMain?: boolean;
  frame?: boolean;
  minAction?: number;
  boxes?: boolean;
  landmarks?: Chrome;
  pictures?: boolean;
  emptyControls?: boolean;
  hardColors?: boolean;
  /** Empty maps (a GL / Leaflet / `[data-kz-map]` box under 120 px, no canvas, no loaded tile); `{ min, required }` to tune, `required` fails a page with no map. */
  maps?: boolean | { min?: number; required?: boolean };
  /** Two interactive elements (buttons, links, inputs, radios…) that share pixels on screen, one not inside the other: one of them cannot be clicked. The box is cut by clipping and scrolling ancestors. */
  controlOverlaps?: boolean;
}
export function problemsOf(where: string, result: Record<string, unknown>, checks?: ProblemChecks): string[];
export function auditOptions<T extends object>(options?: T): T & { reducedMotion: "reduce" };
export function withoutViewTransitions(): void;
export function auditContext(
  browser: { newContext(o?: object): Promise<BrowserContext> },
  options?: object,
): Promise<BrowserContext>;
export function settled(page: Page): Promise<unknown>;
export function loadSettled(page: Page, url: string, options?: object): Promise<BrowserContext>;
export function resizeSettled(page: Page, size: { width: number; height: number }): Promise<void>;
export const WIDTHS: number[];
export const THEMES: string[];
export function isPageError(message: { type(): string; text(): string }, ignore?: RegExp[]): boolean;
export function routesFromSitemap(
  base: string,
  options?: { first?: string[]; limit?: number; fetcher?: typeof fetch },
): Promise<string[] | null>;
export interface RouteSpec {
  url: string;
  name?: string;
  chrome?: Chrome;
  session?: boolean;
}
export interface A11yOptions {
  app: string;
  baseline: string;
  widths?: number[];
  log?: (line: string) => void;
  session?: { app: string; baseline: string };
}
export interface SessionOptions {
  storageState?: object | string;
  signIn?: (context: BrowserContext, o: { base: string; theme: string; page: Page }) => Promise<void>;
  routes?: (page: Page, o: { base: string; theme: string }) => Promise<Array<string | RouteSpec>>;
}
export interface AuditRoutesOptions {
  base: string;
  routes: Array<string | RouteSpec>;
  widths?: Array<number | { width: number; height?: number }>;
  themes?: string[];
  height?: number;
  themeKey?: string;
  shots?: string;
  settleMs?: number;
  ignoreConsole?: RegExp[];
  attempts?: number;
  a11y?: A11yOptions;
  session?: SessionOptions;
  checks?: Omit<ProblemChecks, "errors">;
  prepare?: (page: Page, route: string) => Promise<void>;
  launch?: () => Promise<BrowserContext>;
}
export function auditRoutes(options: AuditRoutesOptions): Promise<string[]>;
export function selfTest(options?: { launch?: () => Promise<BrowserContext> }): Promise<string[]>;
