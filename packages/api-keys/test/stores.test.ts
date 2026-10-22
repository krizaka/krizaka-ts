import { describe } from "vitest";

import { memoryApiKeyStore } from "../src/memory";
import { apiKeyStoreContract } from "../src/testkit";

describe("api key store: memory", () => {
  apiKeyStoreContract("memory", memoryApiKeyStore, (n) => `owner-${n}`);
});
