"use client";

import { SiteFooter as FamilyFooter } from "@krizaka/ui/site-footer";
import { familyLabels } from "@krizaka/ui/sites";
import type { Locale } from "@/lib/i18n";

/* The client half of the footer: @krizaka/ui's SiteFooter.Column / .Link are members of a client component, so they are
   composed here; SiteFooter (server) reads the words and the UI version at build and hands them in. */
export function FamilyFooterView({
  locale,
  aria,
  ui,
  license,
  links,
}: {
  locale: Locale;
  aria: string;
  ui?: string;
  license: string;
  links: { label: string; href: string }[];
}) {
  return (
    <FamilyFooter current="ts" labels={familyLabels[locale]}
      aria-label={aria}
      legal={
        <>
          <span>{license}</span>
          {ui && <span>{`Krizaka UI ${ui}`}</span>}
        </>
      }
    >
      <FamilyFooter.Column title="Krizaka TS">
        {links.map((l) => (
          <FamilyFooter.Link key={l.href} href={l.href}>
            {l.label}
          </FamilyFooter.Link>
        ))}
      </FamilyFooter.Column>
    </FamilyFooter>
  );
}
