import { describe, expect, it } from "vitest";

import { checkEndpointDns, isPrivateAddress } from "../src/node";
import { NOT_AN_IP, NOT_PUBLIC, PUBLIC } from "./fixtures/addresses";

describe("isPrivateAddress (an SSRF guard: anything but a public unicast IP is refused)", () => {
  it.each(NOT_PUBLIC)("refuses %s: %s", (_range, address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(NOT_AN_IP)("fails closed on « %s », which is not an IP", (input) => {
    expect(isPrivateAddress(input)).toBe(true);
  });

  it.each(PUBLIC)("lets a public address through: %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("refuses the cases folioviv's local guard refused (krizaka/folioviv#731)", () => {
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("calendar.example.com")).toBe(true);
    expect(isPrivateAddress("garbage")).toBe(true);
  });

  it("refuses an endpoint whose name resolves to multicast, reserved or a mapped private address", async () => {
    for (const address of ["224.0.0.1", "240.0.0.1", "198.18.0.1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe"])
      await expect(
        checkEndpointDns("https://bucket.example.com", { resolve: async () => ["93.184.216.34", address] }),
      ).rejects.toMatchObject({ code: "STORAGE_BAD_ENDPOINT" });
  });
});
