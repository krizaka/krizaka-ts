import { CDN } from "./org";
import type { AppConfig } from "./org.types";

export const APP_SCHEMA_URL = `${CDN}/org/v1/app.schema.json`;
const UPDATED = "2026-10-26";

const app = (id: string, devUrl: string): AppConfig => ({
  $schema: APP_SCHEMA_URL,
  schemaVersion: 1,
  app: id,
  // Public by nature: an address a client calls. No key, no token, no internal host.
  apiBaseUrl: { dev: devUrl, production: null },
  features: {},
  minAppVersion: "0.0.0",
  updatedAt: UPDATED,
});

/** The runtime config a mobile app may know, per live product. The app reads it at start, with a copy built into the binary as fallback. */
export const apps: Record<string, AppConfig> = {
  sovkora: app("sovkora", "https://dev.sovkora.com"),
  verikora: app("verikora", "https://dev.verikora.com"),
  folioviv: app("folioviv", "https://dev.folioviv.com"),
};
