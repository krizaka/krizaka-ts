import type { Metadata } from "next";
import { cn } from "@krizaka/ui/cn";
import { ThemeProvider, ThemeScript } from "@krizaka/ui/theme";
import { getDictionary } from "@/lib/i18n";
import { displayFace, monoFace, textFace } from "./fonts";
import "./globals.css";

/* The 404 of both languages (the two root layouts bypass layout.tsx): the message in each, and the way back. */
export const metadata: Metadata = { title: "404 — Krizaka TS", robots: { index: false } };

export default function GlobalNotFound() {
  const en = getDictionary("en").notFound;
  const fr = getDictionary("fr").notFound;
  return (
    <html lang="en" className={cn(textFace.variable, displayFace.variable, monoFace.variable, "dark")} suppressHydrationWarning>
      <head>
        <ThemeScript defaultMode="dark" />
      </head>
      <body>
        <ThemeProvider defaultMode="dark">
          <main className="kz-404">
            <section lang="en">
              <h1>{en.title}</h1>
              <p>{en.body}</p>
              <p><a href="/">{en.back}</a></p>
            </section>
            <section lang="fr">
              <h2>{fr.title}</h2>
              <p>{fr.body}</p>
              <p><a href="/fr/">{fr.back}</a></p>
            </section>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
