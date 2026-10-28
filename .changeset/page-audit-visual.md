---
"@krizaka/page-audit": minor
---

`@krizaka/page-audit/visual`: visual regression of the main journeys, one source for every app (krizaka/.github#375). `defineJourneyTests` registers one Playwright `toHaveScreenshot` test per journey × viewport (desktop, phone) × theme (light, dark) with a frozen clock, reduced motion, no View Transition, a fixed locale and time zone, masks for live values, a signed-in persona reused across captures, and a first-paint capture (JavaScript off, or a query held pending) for flashes like krizaka-ui#827.
