#!/usr/bin/env node
// Re-downloads this site's icons from the brand CDN, byte for byte (never redrawn).
// The icons are generated from @krizaka/ui by krizaka-ui tools/export-brand.mjs.
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BRAND = "krizaka";
export const CDN = "https://krizaka-assets.b-cdn.net";
// CDN file -> committed file
export const ICONS = {
  "favicon.svg": "public/favicon.svg",
  "favicon-32.png": "app/icon.png",
  "apple-touch-icon.png": "app/apple-icon.png",
  "icon-192.png": "app/icon1.png",
  "icon-512.png": "app/icon2.png",
};

export async function get(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`${url}: HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw last;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, dest] of Object.entries(ICONS)) {
    await writeFile(resolve(root, dest), await get(`${CDN}/brand/${BRAND}/${name}`));
    console.log(`${dest} <- brand/${BRAND}/${name}`);
  }
}
