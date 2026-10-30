"use client";

/* The bar (NAV-SYS), built on @krizaka/ui's NavBar (floating, tightening on scroll, one light gliding between the items).
   Left: the mark (the home). Centre, this
   site: Get started · Packages — never a link to another site. Right: search · Repo · theme · the family's
   language switch (NavBar.Language, the page in each language).
   Below md: the mark, the search and the mobile panel's toggle (the family is its last group). */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { MoonIcon, SearchIcon, SunIcon } from "@krizaka/icons";
import { KrizakaLogo } from "@krizaka/ui";
import { Button } from "@krizaka/ui/button";
import { Kbd } from "@krizaka/ui/kbd";
import { NavBar } from "@krizaka/ui/nav-bar";
import { languageNames } from "@krizaka/ui/language-switch";
import { LOCALES, localizedPath, splitLocale } from "@/lib/i18n";
import { REPOSITORY_URL } from "@/lib/site";
import { useI18n } from "./I18nProvider";
import { useSiteTheme } from "./SiteTheme";

export default function TopBar({ firstPackage }: { firstPackage: string }) {
  const { locale, t } = useI18n();
  const b = t.bar;
  const { theme, toggleTheme } = useSiteTheme();
  const { setOpenSearch } = useSearchContext();
  const { path } = splitLocale(usePathname() ?? "/");
  const clean = path === "/" ? "/" : path.replace(/\/$/, "");
  const home = localizedPath(locale, "/");
  const start = localizedPath(locale, "/start");
  const packagesHref = localizedPath(locale, `/${firstPackage}`);
  // The same page in each language (English at the root, French under /fr): the language switch of the family.
  const languages = LOCALES.map((l) => ({ code: l, name: languageNames[l] ?? l, href: localizedPath(l, clean) }));

  return (
    <div className="kz-site-bar-wrap pointer-events-none fixed inset-x-0 top-3 z-50">
      <NavBar.Root label={b.aria} className="kz-site-bar pointer-events-auto">
        <NavBar.Brand asChild>
          <Link href={home}>
            <KrizakaLogo size={26} />
            {t.site.name}
          </Link>
        </NavBar.Brand>

        <NavBar.Items>
          <NavBar.Link asChild active={clean === "/start"}>
            <Link href={start}>{b.start}</Link>
          </NavBar.Link>
          <NavBar.Link asChild active={clean !== "/" && clean !== "/start"}>
            <Link href={packagesHref}>{b.packages}</Link>
          </NavBar.Link>
        </NavBar.Items>

        <NavBar.Actions className="gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            shape="pill"
            onClick={() => setOpenSearch(true)}
            aria-label={b.searchAria}
            aria-keyshortcuts="Meta+K Control+K"
            className="w-9 px-0 font-normal text-fg-secondary lg:w-auto lg:pl-3 lg:pr-1.5"
          >
            <SearchIcon size={14} />
            <span className="hidden lg:inline">{b.search}</span>
            <Kbd className="hidden lg:inline-flex">⌘K</Kbd>
          </Button>

          <span aria-hidden className="mx-1 hidden h-4 w-px bg-border-subtle lg:block" />

          <NavBar.Repo href={REPOSITORY_URL} label={b.githubAria} className="hidden lg:inline-flex" />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            shape="pill"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? b.toLight : b.toDark}
            className="hidden h-9 w-9 md:inline-flex"
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </Button>

          {/* Below md the language is in the mobile panel: the mark, the search and the toggle are all that fits at 360 px. */}
          <NavBar.Language
            label={b.language}
            current={locale}
            languages={languages}
            linkAs={Link}
            className="hidden md:inline-flex"
          />

          <NavBar.Mobile
            openLabel={b.menu}
            closeLabel={b.menu}
            className="max-h-[calc(100dvh-6rem)] gap-1 overflow-y-auto overscroll-contain p-3"
          >
            <NavBar.MobileLink asChild active={clean === "/start"}>
              <Link href={start}>{b.start}</Link>
            </NavBar.MobileLink>
            <NavBar.MobileLink asChild active={clean !== "/" && clean !== "/start"}>
              <Link href={packagesHref}>{b.packages}</Link>
            </NavBar.MobileLink>
            <NavBar.MobilePreferences label={b.preferences}>
              <Button type="button" variant="secondary" size="md" onClick={toggleTheme} className="min-h-11">
                {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
                {theme === "dark" ? b.toLight : b.toDark}
              </Button>
              <NavBar.Language label={b.language} current={locale} languages={languages} linkAs={Link} />
            </NavBar.MobilePreferences>
          </NavBar.Mobile>
        </NavBar.Actions>
      </NavBar.Root>
    </div>
  );
}
