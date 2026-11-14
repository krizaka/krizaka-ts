import { describe, expect, it } from "vitest";

import { checkEndpoint, STORAGE_CODE } from "../src/index";
import { isPrivateAddress } from "../src/node";
import { NOT_PUBLIC, PUBLIC } from "./fixtures/addresses";

/** The endpoint an administrator would type to reach `address`: IPv6 goes in brackets, with a port and a path to be sure they change nothing. */
const endpointOf = (address: string) => `https://${address.includes(":") ? `[${address}]` : address}:8443/bucket`;

/** The literals a URL can carry: a zone id (`%eth0`) is not one, the URL parser refuses it before any rule runs. */
const IN_A_URL = NOT_PUBLIC.filter(([, address]) => !address.includes("%"));

const refused = (endpoint: string) => {
  try {
    checkEndpoint(endpoint);
    return false;
  } catch (error) {
    expect(error).toMatchObject({ code: STORAGE_CODE.badEndpoint });
    return true;
  }
};

describe("checkEndpoint judges a literal host with isPrivateAddress, the one SSRF rule", () => {
  it.each(IN_A_URL)("refuses %s: %s", (_range, address) => {
    expect(() => checkEndpoint(endpointOf(address))).toThrow("endpoint must not be a private address");
  });

  it.each(PUBLIC)("lets a public address through: %s", (address) => {
    expect(checkEndpoint(endpointOf(address))).toBe(new URL(endpointOf(address)).origin);
  });

  it("refuses exactly what isPrivateAddress refuses, for every literal of the table", () => {
    for (const address of [...IN_A_URL.map(([, a]) => a), ...PUBLIC])
      expect(refused(endpointOf(address)), address).toBe(isPrivateAddress(address));
  });

  it("refuses the other spellings of a private address, which the URL parser turns into the canonical one", () => {
    for (const endpoint of [
      "https://2130706433",
      "https://0x7f.0.0.1",
      "https://0177.0.0.1",
      "https://0xa9fea9fe",
      "https://[::ffff:7f00:1]",
      "https://[0:0:0:0:0:ffff:169.254.169.254]:9000/latest",
      "https://[64:ff9b::a00:1]",
      "https://[FE80::1]",
    ])
      expect(() => checkEndpoint(endpoint), endpoint).toThrow("endpoint must not be a private address");
  });

  it("still lets a host name through (its DNS answer is checkEndpointDns's job) and still refuses a local name", () => {
    for (const endpoint of [
      "https://tor1.digitaloceanspaces.com",
      "https://s3.ca-central-1.amazonaws.com",
      "https://bucket.example.com:8443",
      "https://10.example.com",
      "https://fd00.example.com",
    ])
      expect(checkEndpoint(endpoint)).toBe(new URL(endpoint).origin);
    for (const endpoint of ["https://localhost", "https://minio.local", "https://db.internal", "https://a.localhost"])
      expect(() => checkEndpoint(endpoint), endpoint).toThrow("endpoint must not be a local name");
  });
});
