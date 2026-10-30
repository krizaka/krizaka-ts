import { describe, expect, it } from "vitest";

import { STORAGE_CODE, StorageError } from "../src/port";
import { readUpload } from "../src/read-upload";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function post(fields: Record<string, string | Blob>, headers: Record<string, string> = {}) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") body.set(name, value);
    else body.set(name, value, "a.png");
  }
  return new Request("https://x.test/upload", { method: "POST", body, headers });
}
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as StorageError).code;
  }
  return null;
};

describe("readUpload", () => {
  it("returns the bytes, the name, the declared type and the form", async () => {
    const result = await readUpload(post({ file: new Blob([PNG], { type: "image/png" }), purpose: "gallery" }), {
      field: "file",
      maxBytes: 1024,
    });
    expect([...result.bytes]).toEqual([...PNG]);
    expect(result.name).toBe("a.png");
    expect(result.declaredType).toBe("image/png");
    expect(result.form.get("purpose")).toBe("gallery");
  });

  it("refuses an oversize body from Content-Length, before reading it", async () => {
    const request = post({ file: new Blob([PNG]) }, { "content-length": String(10 * 1024 * 1024) });
    expect(await code(readUpload(request, { field: "file", maxBytes: 1024 }))).toBe(STORAGE_CODE.tooBig);
  });

  it("refuses a file larger than the limit and an empty one", async () => {
    expect(
      await code(readUpload(post({ file: new Blob([new Uint8Array(2000)]) }), { field: "file", maxBytes: 1024 })),
    ).toBe(STORAGE_CODE.tooBig);
    expect(await code(readUpload(post({ file: new Blob([]) }), { field: "file", maxBytes: 1024 }))).toBe(
      STORAGE_CODE.tooBig,
    );
  });

  it("refuses a missing field, a text field and a body that is not a form", async () => {
    expect(await code(readUpload(post({ other: new Blob([PNG]) }), { field: "file", maxBytes: 1024 }))).toBe(
      STORAGE_CODE.noFile,
    );
    expect(await code(readUpload(post({ file: "text" }), { field: "file", maxBytes: 1024 }))).toBe(STORAGE_CODE.noFile);
    const notForm = new Request("https://x.test/upload", {
      method: "POST",
      body: "nope",
      headers: { "content-type": "text/plain" },
    });
    expect(await code(readUpload(notForm, { field: "file", maxBytes: 1024 }))).toBe(STORAGE_CODE.noFile);
  });
});
