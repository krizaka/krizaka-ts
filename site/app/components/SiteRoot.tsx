import type { ReactNode } from "react";
import { MotionObserver } from "@krizaka/ui/motion";
import { ThemeProvider, ThemeScript } from "@krizaka/ui/theme";
import { SkipLink } from "@krizaka/ui/skip-link";
import { cn } from "@krizaka/ui/cn";
import { getDictionary, type Locale } from "@/lib/i18n";
import { displayFace, monoFace, textFace } from "../fonts";
import { DocsProviders } from "./DocsProviders";
import { I18nProvider } from "./I18nProvider";
import { packages } from "@/lib/packages";
import SiteFooter from "./SiteFooter";
import { ThemeSync } from "./SiteTheme";
import TopBar from "./TopBar";
import "@krizaka/ui/blocks.css";
import "../globals.css";

/* The root of one language (the two root layouts, app/(en) and app/fr, are this): the document, the Krizaka faces, the
   theme (dark by default, persisted as `kz-theme`, no flash), the bar, the page (the home, or the documentation in
   Fumadocs' layout — DocsShell, by the (docs) route group), the footer, and the motion system of @krizaka/ui. */
export default function SiteRoot({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getDictionary(locale);
  return (
    <html
      lang={locale}
      className={cn(textFace.variable, displayFace.variable, monoFace.variable, "h-full dark")}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <ThemeScript defaultMode="dark" />
        <meta name="theme-color" content="#0d0d0f" />
      </head>
      <body className="flex min-h-dvh flex-col antialiased">
        <ThemeProvider defaultMode="dark">
          <ThemeSync />
          <I18nProvider locale={locale} messages={t}>
            <DocsProviders>
              <SkipLink href="#nd-page">{t.bar.skip}</SkipLink>
              <TopBar firstPackage={packages()[0].id} />
              {children}
              <SiteFooter locale={locale} />
            </DocsProviders>
          </I18nProvider>
          <MotionObserver />
        </ThemeProvider>
      </body>
    </html>
  );
}
