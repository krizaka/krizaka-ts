import { CDN, ORG_SCHEMA_URL } from "./org";

const localized = {
  type: "object",
  additionalProperties: false,
  required: ["fr", "en"],
  properties: { fr: { type: "string", minLength: 1 }, en: { type: "string", minLength: 1 } },
} as const;
const httpsUrl = { type: "string", format: "uri", pattern: "^https://" } as const;
const mark = {
  type: "object",
  additionalProperties: false,
  required: ["svg", "png64", "png256", "png512", "png1024"],
  properties: { svg: httpsUrl, png64: httpsUrl, png256: httpsUrl, png512: httpsUrl, png1024: httpsUrl },
} as const;
const slug = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" } as const;
const themed = { type: "object", additionalProperties: false, required: ["dark", "light"], properties: { dark: mark, light: mark } } as const;
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const semver = { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" } as const;

/** The JSON Schema of `org/v1/org.json`. Nothing outside it is allowed (`additionalProperties: false` everywhere): a new fact is a new line here first. */
export const orgSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ORG_SCHEMA_URL,
  title: "Krizaka organisation — public facts",
  type: "object",
  additionalProperties: false,
  required: ["$schema", "schemaVersion", "version", "updatedAt", "company", "brand", "people", "products", "sites", "contact", "footer"],
  properties: {
    $schema: { type: "string" },
    schemaVersion: { const: 1 },
    version: semver,
    updatedAt: date,
    company: {
      type: "object",
      additionalProperties: false,
      required: ["legalName", "tradeName", "neq", "city", "region", "country", "license", "madeIn"],
      properties: {
        legalName: { type: "string", minLength: 1 },
        tradeName: { type: "string", minLength: 1 },
        neq: { type: "string", pattern: "^\\d{10}$" },
        city: { type: "string", minLength: 1 },
        region: { type: "string", minLength: 1 },
        country: { type: "string", pattern: "^[A-Z]{2}$" },
        license: { type: "string", minLength: 1 },
        madeIn: localized,
      },
    },
    brand: {
      type: "object",
      additionalProperties: false,
      required: ["name", "logo", "mark", "favicon", "appleTouchIcon", "socialPreview", "manifest"],
      properties: { name: { type: "string", minLength: 1 }, logo: themed, mark: themed, favicon: httpsUrl, appleTouchIcon: httpsUrl, socialPreview: httpsUrl, manifest: httpsUrl },
    },
    people: {
      type: "object",
      additionalProperties: false,
      required: ["defaults", "banners"],
      properties: {
        defaults: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "svg", "webp256", "webp512", "alt"],
            properties: { id: slug, kind: { enum: ["person", "plain"] }, svg: httpsUrl, webp256: httpsUrl, webp512: httpsUrl, alt: localized },
          },
        },
        banners: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["id", "url", "alt"], properties: { id: slug, url: httpsUrl, alt: localized } },
        },
      },
    },
    products: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "status", "url", "repo"],
        properties: { id: slug, name: { type: "string", minLength: 1 }, status: { enum: ["development", "devPreview"] }, url: httpsUrl, repo: httpsUrl },
      },
    },
    sites: {
      type: "array",
      minItems: 1,
      items: { type: "object", additionalProperties: false, required: ["id", "name", "url"], properties: { id: slug, name: { type: "string", minLength: 1 }, url: httpsUrl } },
    },
    contact: {
      type: "object",
      additionalProperties: false,
      required: ["page", "email"],
      properties: {
        page: { type: "object", additionalProperties: false, required: ["fr", "en"], properties: { fr: httpsUrl, en: httpsUrl } },
        email: { type: ["string", "null"], format: "email" },
      },
    },
    footer: {
      type: "object",
      additionalProperties: false,
      required: ["line", "legal"],
      properties: {
        line: localized,
        legal: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "url"],
            properties: { id: { enum: ["privacy", "terms"] }, label: localized, url: { type: "object", additionalProperties: false, required: ["fr", "en"], properties: { fr: httpsUrl, en: httpsUrl } } },
          },
        },
      },
    },
  },
} as const;

/** The JSON Schema of `apps/<product>.json`. */
export const appSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${CDN}/org/v1/app.schema.json`,
  title: "Krizaka mobile app — public runtime config",
  type: "object",
  additionalProperties: false,
  required: ["$schema", "schemaVersion", "app", "apiBaseUrl", "features", "minAppVersion", "updatedAt"],
  properties: {
    $schema: { type: "string" },
    schemaVersion: { const: 1 },
    app: slug,
    apiBaseUrl: {
      type: "object",
      additionalProperties: false,
      required: ["dev", "production"],
      properties: { dev: { anyOf: [httpsUrl, { type: "null" }] }, production: { anyOf: [httpsUrl, { type: "null" }] } },
    },
    features: { type: "object", additionalProperties: { type: "boolean" } },
    minAppVersion: semver,
    updatedAt: date,
  },
} as const;
