import { brandOf, DISPLAY_NAME_MAX, findCodeNames } from "@krizaka/org";
import { z } from "zod";

import { type Def, GLOBAL_ONLY, KIND } from "./registry";

/** The key of the name an app shows (krizaka-internal#2035): the administrator sets it, the default is the commercial name. */
export const DISPLAY_NAME_KEY = "brand.displayName";

/**
 * The setting of the product's displayed name, for a product's registry: `{ [DISPLAY_NAME_KEY]: displayNameSetting("yomizaka") }`.
 * Its default is the commercial name of `@krizaka/org` (« Verikora »); the admin screen draws it from `describeSettings` like any
 * text setting. A code name is refused: the customer never reads one. The app shows it through `displayName(codeName, value)`.
 */
export const displayNameSetting = (codeName: string): Def<string> => ({
  group: "brand",
  kind: KIND.text,
  schema: z
    .string()
    .trim()
    .min(1)
    .max(DISPLAY_NAME_MAX)
    .refine((v) => findCodeNames(v).length === 0, { message: "a code name is never shown to a customer" }),
  default: brandOf(codeName).commercialName,
  scopes: GLOBAL_ONLY,
  max: DISPLAY_NAME_MAX,
});
