import { describe } from "vitest";

import { memoryFollowStore } from "../src/memory";
import { followStoreContract } from "../src/testkit";

describe("follow store: memory", () => {
  followStoreContract("memory", memoryFollowStore, (n) => `subject-${n}`);
});
