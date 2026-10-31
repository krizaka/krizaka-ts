# @krizaka/contract

Declare a response contract once (zod), assert it everywhere the answer is acted on: route tests, journeys, synthetic monitors and
the fetch wrappers of runtime boundaries. ADR-022 (krizaka-internal#1969), slice #1971.

**Why.** « Sent to undefined of undefined » and every « 204 = success » share one class of defect: a response without the fields its
caller reads passed. One schema per response, asserted in three places.

```ts
import { z } from "zod";
import { count, defineContract, expectProviderAnswer, fetchContract, nonEmptyList, text } from "@krizaka/contract";

// 1. Declare it once, export it.
export const newsletterSend = defineContract(
  "newsletter send",
  z.object({ sent: count(), total: count(), ids: nonEmptyList(text()) }),
);

// 2. Route / integration test: 2xx, JSON body, schema — else it throws with the field's path.
const body = await newsletterSend.expect(response);

// 3. Runtime boundary: the fetch wrapper fails on network error, non-2xx, empty or non-JSON body, missing field.
const result = await fetchContract(fetch, url, { method: "POST", body }, newsletterSend);

// Provider calls we act on (mail, payments, storage): accepted count >= 1 (or exactly what we sent) and the provider's id.
await expectProviderAnswer(response, z.object({ id: text(), accepted: count() }), {
  expectedAccepted: recipients.length,
});
```

## What fails

- a non-2xx status; a **204 or any empty body**; a body that is not JSON;
- a missing field, a wrong type; an `undefined` or `NaN` anywhere in the answer (even under `z.unknown()`);
- an **empty string** (pass `allowEmptyStrings: true`, or declare `.optional()`, where it is legitimate);
- `count()`: a finite integer >= 0; `nonEmptyList(item)`: at least one item; `text()`: a non-empty trimmed string.

Every failure is a `ContractError` with `issues: { path, message }[]` (`recipients.1`, `total`) and `status`. **Values and URLs are
never put in the message** — an answer or a URL may carry a secret.

## Exports

`defineContract`, `expectContract`, `assertContract`, `expectProviderAnswer`, `fetchContract`, `ContractError`, and the builders `text`,
`count`, `nonEmptyList`. `zod >= 4` is a peer dependency. Java services keep `orazaka-contracts` (httpyac).
