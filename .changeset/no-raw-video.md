---
"@krizaka/config": minor
---

New ast-grep rule `no-raw-video` in the `web` set: a JSX `<video>` or `createElement("video")` is refused in favour of the `@krizaka/ui` media components (`MediaCarousel`, `VideoPlayer`, `VerticalVideo`, `PausableLoop`, `media-player`). A product records its current count once with `sg:ratchet:update`; the count only goes down.
