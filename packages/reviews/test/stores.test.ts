import { describe } from "vitest";

import { memoryReviewStore } from "../src/memory";
import { reviewStoreContract } from "../src/testkit";

describe("review store: memory", () => {
  reviewStoreContract("memory", memoryReviewStore, (n) => `subject-${n}`);
});
