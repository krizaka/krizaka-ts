#!/usr/bin/env node
// Creates, idempotently, a product's catalogue at the processor (products, prices, customer portal, webhook) from a JSON file.
//   krizaka-payments-setup --catalogue catalogue.json [--webhook-url https://…] [--secret-out file] [--i-am-the-owner]
// The key is read from PAYMENTS_STRIPE_SECRET_KEY; test or live is decided by it. It is never printed; a NEW webhook's
// signing secret is written to --secret-out (mode 0600), because the processor shows it once.
import { readFileSync, writeFileSync } from "node:fs";

import { ensureCatalogue, stripeCall } from "../dist/index.js";

const key = process.env.PAYMENTS_STRIPE_SECRET_KEY;
if (!key) throw new Error("PAYMENTS_STRIPE_SECRET_KEY is not set");
const args = process.argv.slice(2);
const flag = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const file = flag("catalogue");
if (!file) throw new Error("--catalogue <file.json> is required");

const { call, mode } = stripeCall({ secretKey: key });
console.log(`mode: ${mode}`);
const result = await ensureCatalogue(call, JSON.parse(readFileSync(file, "utf8")), { mode, owner: args.includes("--i-am-the-owner"), webhookUrl: flag("webhook-url") });
for (const p of result.prices) console.log(`price ${p.lookupKey}: ${p.status}`);
console.log(`portal configuration: ${result.portal}`);
if (result.webhook?.status === "exists") console.log("webhook: exists — its signing secret is not shown again");
if (result.webhook?.status === "created") {
  const out = flag("secret-out");
  if (!out) throw new Error("A new webhook was created: pass --secret-out to keep its signing secret");
  writeFileSync(out, result.webhook.secret, { mode: 0o600 });
  console.log(`webhook: created, signing secret written to ${out}`);
}
console.log(`tax: ${result.tax}`);
