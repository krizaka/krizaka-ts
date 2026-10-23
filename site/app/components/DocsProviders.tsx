"use client";

import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { useI18n } from "./I18nProvider";

/* Fumadocs' providers: the static search ("/" or ⌘K opens it) and its interface texts from the site's messages. The theme
   stays the site's (ThemeProvider, html.light), so Fumadocs' own is off. */
export function DocsProviders({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const c = t.chrome;
  const translations: Record<string, string> = {
    "Search(search trigger)": c.search,
    "Search(search dialog)": c.search,
    "No results found(search dialog)": c.searchNoResults,
    "On this page(table of contents)": c.onThisPage,
    "No Headings(table of contents)": c.noHeadings,
    "Next Page(pagination)": c.nextPage,
    "Previous Page(pagination)": c.previousPage,
    "Copy Text(code block)(aria-label)": c.copy,
    "Copied Text(code block)(aria-label)": c.copied,
    "Open Sidebar(sidebar)(aria-label)": c.openSidebar,
    "Close Sidebar(sidebar)(aria-label)": c.closeSidebar,
    "Close Sidebar(aria-label)": c.closeSidebar,
    "Collapse Sidebar(sidebar)(aria-label)": c.collapseSidebar,
    "Open Search(search trigger)(aria-label)": c.openSearch,
    "Close Search(search dialog)(aria-label)": c.closeSearch,
    "Last updated on(page footer)": c.lastUpdated,
  };
  return (
    <RootProvider
      theme={{ enabled: false }}
      search={{ options: { type: "static", api: "/search.json" }, hotKey: [{ display: "/", key: "/" }, { display: "⌘K", key: "k" }] }}
      i18n={{ locale, translations }}
    >
      {children}
    </RootProvider>
  );
}
