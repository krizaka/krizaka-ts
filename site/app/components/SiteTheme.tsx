"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useTheme } from "@krizaka/ui/theme";

/* The site's view of the @krizaka/ui theme (ThemeProvider + ThemeScript in the layout, persisted as `kz-theme`): the mode
   resolved to the theme actually shown, a dark ⇄ light toggle, and the two things the primitive leaves to the page — the
   browser's theme-color and the `dark` class Fumadocs reads for its own dark variants (code highlighting). */

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useSiteTheme() {
  const { mode, setMode } = useTheme();
  const systemDark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK_QUERY).matches,
    () => true,
  );
  const theme: "dark" | "light" = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  const toggleTheme = useCallback(() => setMode(theme === "dark" ? "light" : "dark"), [theme, setMode]);
  return { theme, toggleTheme };
}

/** Keeps `<meta name="theme-color">` and Fumadocs' `dark` class on the theme shown. Renders nothing. */
export function ThemeSync() {
  const { theme } = useSiteTheme();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    const surface = getComputedStyle(document.documentElement).getPropertyValue("--kz-surface-0").trim();
    if (meta && surface) meta.setAttribute("content", surface);
  }, [theme]);
  return null;
}
