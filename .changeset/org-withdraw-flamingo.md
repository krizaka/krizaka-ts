---
"@krizaka/org": patch
---

The neon flamingo banner (`banner/the-neon-flamingo`) is withdrawn from the defaults: it carries the wordmark of a paused product. It stays in the JSON with `disabled: true` and its files stay served (a versioned URL never changes), but `listDefaults` and `defaultFor` skip it, so a banner is picked among eleven. The schema accepts `disabled`; a test holds that no default names a paused product.
