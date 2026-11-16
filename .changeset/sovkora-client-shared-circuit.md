---
"@krizaka/sovkora-client": minor
---

The circuit breaker now comes from `@krizaka/resilience`; behaviour and `SOVKORA_*` codes are unchanged. `createCircuit` is no longer exported from here: import it from `@krizaka/resilience` (the `Circuit`, `CircuitOptions` and `Clock` types are still re-exported).
