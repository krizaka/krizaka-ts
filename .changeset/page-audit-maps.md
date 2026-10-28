---
"@krizaka/page-audit": minor
---

`maps` check: an empty map fails the audit (a GL / Leaflet / `[data-kz-map]` box under 120 px on a side, a GL map with no canvas, a Leaflet map with no loaded tile; `maps: { required: true }` also fails a page that should draw one). Proven on its own fixtures in the self-test (krizaka-ts#199, akinaza#488).
