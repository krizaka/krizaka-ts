# @krizaka/reviews

Collect one editable review per subject and target, let the product set verification and moderation state, attach an owner reply, and compute a Bayesian score from published verified reviews only. Products supply the prior and own authorization and moderation rules.

```ts
import { createReviews, reviewsMigration, pgReviewStore } from "@krizaka/reviews";

await db.query(reviewsMigration());
const reviews = createReviews({ store: pgReviewStore(query), clock: { now: () => new Date() }, rules: { initialState: "pending" } });
const review = await reviews.submit({ subjectId, target: { targetType: "shop", targetId: shopId }, rating: 5, text: "Excellent", verified: true });
await reviews.setState(review.id, "published");
await reviews.reply(review.id, "Thank you for your feedback");
const score = await reviews.score({ targetType: "shop", targetId: shopId }, { mean: 4, weight: 10 });
```

`list` returns published reviews by default; owner and admin views can pass `{ states: ["pending", "hidden_by_owner"] }`. `score` returns the Bayesian average, the 1–5 rating distribution and the number of included reviews. The product supplies `verified`; the package never infers it. Every adapter can run `reviewStoreContract` from `@krizaka/reviews/testkit`.
