import { ImageResponse } from "next/og";
import { getDictionary } from "@/lib/i18n";

/* The social preview of every page (a static file at build: /og.png, 1200×630) — the name, the one line, the family. */
export const dynamic = "force-static";

export function GET() {
  const t = getDictionary("en");
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "radial-gradient(circle at 80% 20%, #1e3a8a 0%, #0d0d0f 55%), #0d0d0f",
        color: "#fafafa",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 96, fontWeight: 900, letterSpacing: -2 }}>
        {t.site.name}
        <span style={{ color: "#60a5fa" }}>.</span>
      </div>
      <div style={{ marginTop: 24, fontSize: 42, fontWeight: 600, maxWidth: 960, lineHeight: 1.25 }}>
        {t.site.tagline}
      </div>
      <div style={{ marginTop: "auto", fontSize: 24, color: "#a1a1aa" }}>{`ts.krizaka.com · ${t.site.project}`}</div>
    </div>,
    { width: 1200, height: 630 },
  );
}
