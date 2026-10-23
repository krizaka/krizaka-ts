import { getDictionary, type Locale } from "@/lib/i18n";
import { NPM_ORG_URL, REPOSITORY_URL } from "@/lib/site";
import { uiVersion } from "@/lib/platform";
import { FamilyFooterView } from "./FamilyFooterView";

/* The footer (NAV-SYS) is @krizaka/ui's SiteFooter: this site's own column (where the packages and the code are), the
   Krizaka family in columns, the signature, the Krizaka UI release it was built with. */
export default function SiteFooter({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).footer;
  return (
    <FamilyFooterView
      locale={locale}
      aria={t.aria}
      ui={uiVersion()}
      license={t.license}
      links={[
        { label: t.npm, href: NPM_ORG_URL },
        { label: t.source, href: REPOSITORY_URL },
      ]}
    />
  );
}
