// The flat config of a Next.js app: eslint-config-next (core web vitals + TypeScript, which already carry
// typescript-eslint, React hooks and import), on top of the shared Krizaka basics. eslint-config-next is an
// optional peer dependency: only Next.js apps install it.
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { krizakaCommon } from "./index.js";

/** @type {import("eslint").Linter.Config[]} */
export const krizakaNext = [
  ...krizakaCommon,
  { name: "krizaka/js", ...js.configs.recommended },
  ...nextVitals,
  ...nextTs,
];

export default krizakaNext;
