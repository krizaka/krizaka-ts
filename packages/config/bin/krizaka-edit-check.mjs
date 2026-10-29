#!/usr/bin/env node
// krizaka-edit-check: the single-file check after an agent's edit (ADR-015 §7). Findings on stderr with exit 2; silent otherwise.
import { fileURLToPath } from "node:url";

import { cacheDir, checkFile, editedFile, installPmd, readStdin } from "../edit-check/edit-check.js";

const argument = process.argv[2];
if (argument === "--install") {
  await installPmd(cacheDir()).catch(() => undefined);
  process.exit(0);
}
const file = editedFile(argument, readStdin());
if (file) {
  const { code, message } = checkFile(file, { script: fileURLToPath(import.meta.url) });
  if (message) console.error(message);
  process.exit(code);
}
