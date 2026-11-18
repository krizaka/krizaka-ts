import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { mayImportSdk, sdkImports, violations } from "./check-aws-sdk.mjs";

describe("sdkImports", () => {
  it("finds static, dynamic and require imports of the SDK", () => {
    expect(sdkImports('import { S3Client } from "@aws-sdk/client-s3";')).toEqual(["@aws-sdk/client-s3"]);
    expect(sdkImports("const kms = await import('@aws-sdk/client-kms');")).toEqual(["@aws-sdk/client-kms"]);
    expect(sdkImports('const A = require("aws-sdk");')).toEqual(["aws-sdk"]);
    expect(sdkImports('import "@smithy/node-http-handler";')).toEqual(["@smithy/node-http-handler"]);
  });
  it("ignores other imports and mere mentions", () => {
    expect(sdkImports('import x from "arctic"; // no @aws-sdk here\nconst s = "aws-sdk-like";')).toEqual([]);
  });
});

describe("mayImportSdk", () => {
  it("allows only the two adapter folders", () => {
    expect(mayImportSdk("packages/storage/src/adapters/s3/store.ts")).toBe(true);
    expect(mayImportSdk("packages/storage/src/adapters/aws-kms/keys.ts")).toBe(true);
    expect(mayImportSdk("packages/storage/src/bucket-store.ts")).toBe(false);
    expect(mayImportSdk("packages/storage/src/adapters/other/x.ts")).toBe(false);
  });
});

describe("violations", () => {
  let root;
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));
  const make = (files) => {
    root = mkdtempSync(join(tmpdir(), "sdkguard-"));
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    return root;
  };

  it("fails on an SDK import outside the adapters", () => {
    const r = make({
      "packages/storage/src/adapters/s3/store.ts": 'import { S3Client } from "@aws-sdk/client-s3";',
      "packages/storage/src/bucket-store.ts": 'import { S3Client } from "@aws-sdk/client-s3";',
      "packages/other/src/a.ts": 'const m = require("aws-sdk");',
    });
    expect(violations(r)).toEqual([
      { file: "packages/other/src/a.ts", module: "aws-sdk" },
      { file: "packages/storage/src/bucket-store.ts", module: "@aws-sdk/client-s3" },
    ]);
  });

  it("passes when the SDK is only in the adapters", () => {
    expect(violations(make({ "packages/storage/src/adapters/aws-kms/k.ts": 'import "@aws-sdk/client-kms";' }))).toEqual(
      [],
    );
  });

  it("passes on this repository today", () => {
    expect(violations(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
  });
});
