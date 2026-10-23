import Link from "next/link";
import { BookmarkIcon, ClockIcon, ExternalIcon, ForwardIcon, GlobeIcon, LinkIcon, PackIcon, SettingsIcon, ShieldIcon, StudioIcon, UserIcon } from "@krizaka/icons";
import { Button } from "@krizaka/ui/button";
import { ArgumentCard } from "@krizaka/ui/argument-card";
import { CardGrid } from "@krizaka/ui/card-grid";
import { LandingPage } from "@krizaka/ui/landing-page";
import { LinkCard } from "@krizaka/ui/link-card";
import { NumberTicker } from "@krizaka/ui/number-ticker";
import { Section } from "@krizaka/ui/page";
import { format, getDictionary, localizedPath, type Locale } from "@/lib/i18n";
import { exportedNames, packages } from "@/lib/packages";
import { JAVA_URL, NPM_ORG_URL, REPOSITORY_URL, UI_URL, npmPackageUrl } from "@/lib/site";
import InstallTabs from "./InstallTabs";

/* The home of ts.krizaka.com, on the landing template of @krizaka/ui: a split hero (the promise, and the install command in
   each package manager), the facts read at build, why (three pillars), the packages (one card each, from the generated
   data), the ways on. Every figure is data (the packages and npm); every word is a message. */

const ICONS: Record<string, typeof PackIcon> = { auth: ShieldIcon, settings: SettingsIcon, "api-keys": LinkIcon, webhooks: ForwardIcon, organize: BookmarkIcon, brief: ClockIcon };

export default function Home({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const t = dict.home;
  const path = (p: string) => localizedPath(locale, p);
  const all = packages();
  const first = all[0];
  const licenses = [...new Set(all.map((p) => p.license))];
  const nodes = [...new Set(all.map((p) => p.node).filter((n): n is string => Boolean(n)))];

  return (
    <main id="nd-page" className="jh-home">
      <LandingPage
        eyebrow={t.hero.eyebrow}
        title={t.hero.title}
        lead={t.hero.lead}
        actions={
          <>
            <Button asChild variant="primary" size="lg">
              <Link href={path("/start")}>
                {t.hero.start} <ForwardIcon size={16} aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="#packages">{t.hero.packages}</a>
            </Button>
          </>
        }
        visualLabel="npm"
        visual={
          <div className="jh-gen">
            <InstallTabs names={all.map((p) => p.name).join(" ")} locale={locale} />
          </div>
        }
        proofs={[
          { value: <NumberTicker value={all.filter((p) => p.version).length} locale={locale} />, label: t.proofs.packages },
          { value: <NumberTicker value={all.reduce((n, p) => n + exportedNames(p), 0)} locale={locale} />, label: t.proofs.exports },
          { value: licenses.join(" · "), label: t.proofs.license },
          ...(nodes.length === 1 ? [{ value: <span className="jh-mono">Node {nodes[0]}</span>, label: t.proofs.node }] : []),
        ]}
        featuresHeading={{ eyebrow: t.pillars.eyebrow, title: t.pillars.title, lead: t.pillars.lead }}
        features={[
          { id: "ports", size: "lg", icon: <PackIcon size={22} />, title: t.pillars.ports.title, text: t.pillars.ports.text },
          { id: "proven", size: "md", icon: <StudioIcon size={22} />, title: t.pillars.proven.title, text: t.pillars.proven.text },
          { id: "released", size: "md", icon: <UserIcon size={22} />, title: t.pillars.released.title, text: t.pillars.released.text },
        ]}
        closing={{
          title: t.closing.title,
          body: t.closing.body,
          actions: (
            <>
              <Button asChild variant="primary" size="lg">
                <Link href={path(`/${first.id}`)}>{t.closing.packages}</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href={REPOSITORY_URL}>
                  {t.closing.source} <ExternalIcon size={16} aria-hidden />
                </a>
              </Button>
            </>
          ),
        }}
      >
        <Section id="packages" eyebrow={t.packages.eyebrow} title={format(t.packages.title, { count: String(all.length) })} lead={t.packages.lead} reveal divider>
          <CardGrid min={290} columns={3}>
            {all.map((p) => {
              const Icon = ICONS[p.id] ?? PackIcon;
              return (
                <ArgumentCard
                  key={p.id}
                  id={`package-${p.id}`}
                  icon={<Icon size={22} aria-hidden />}
                  title={p.name}
                  meta={p.node ? `Node ${p.node}` : undefined}
                  hook={{ label: t.packages.hookLabel, text: dict.packages[p.id as keyof typeof dict.packages].hook }}
                  facts={[p.version ? { label: format(t.packages.published, { version: p.version }), tone: "ok", href: npmPackageUrl(p.name) } : { label: t.packages.unpublished, tone: "wip" }]}
                  more={{ href: path(`/${p.id}`), label: t.packages.details }}
                  linkAs={Link}
                />
              );
            })}
          </CardGrid>
        </Section>

        <Section id="go" eyebrow={t.go.eyebrow} title={t.go.title} reveal divider>
          <CardGrid min={260} columns={3}>
            <LinkCard href={REPOSITORY_URL} icon={<BookmarkIcon size={22} aria-hidden />} title={t.go.source.title} description={t.go.source.text} />
            <LinkCard href={NPM_ORG_URL} icon={<PackIcon size={22} aria-hidden />} title={t.go.npm.title} description={t.go.npm.text} />
            <LinkCard href={JAVA_URL} icon={<StudioIcon size={22} aria-hidden />} title={t.go.java.title} description={t.go.java.text} />
            <LinkCard href={UI_URL} icon={<GlobeIcon size={22} aria-hidden />} title={t.go.ui.title} description={t.go.ui.text} />
          </CardGrid>
        </Section>
      </LandingPage>
    </main>
  );
}
