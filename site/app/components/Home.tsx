import Link from "next/link";
import {
  BookmarkIcon,
  ClockIcon,
  ExternalIcon,
  ForwardIcon,
  GlobeIcon,
  LinkIcon,
  PackIcon,
  SettingsIcon,
  ShieldIcon,
  StudioIcon,
  UserIcon,
} from "@krizaka/icons";
import { Button } from "@krizaka/ui/button";
import { ArgumentCard } from "@krizaka/ui/argument-card";
import { CardGrid } from "@krizaka/ui/card-grid";
import { CtaPanel } from "@krizaka/ui/cta-panel";
import { LinkCard } from "@krizaka/ui/link-card";
import { Section } from "@krizaka/ui/page";
import { PageHero } from "@krizaka/ui/page-hero";
import { SpecimenTag } from "@krizaka/ui/specimen-tag";
import { format, getDictionary, localizedPath, type Locale } from "@/lib/i18n";
import { HERO_PACKAGE } from "@/lib/install";
import { packages } from "@/lib/packages";
import { JAVA_URL, NPM_ORG_URL, REPOSITORY_URL, UI_URL, npmPackageUrl } from "@/lib/site";
import InstallTabs from "./InstallTabs";

/* The home of ts.krizaka.com: a hero (the promise, and beside it the install command of the foundation package in each
   package manager, one frame), its facts as a specimen tag under the actions, why (three pillars), the packages (one card
   each, from the generated data), the ways on. Every figure is data (the packages and npm); every word is a message. */

const ICONS: Record<string, typeof PackIcon> = {
  auth: ShieldIcon,
  settings: SettingsIcon,
  "api-keys": LinkIcon,
  webhooks: ForwardIcon,
  organize: BookmarkIcon,
  brief: ClockIcon,
};

export default function Home({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const t = dict.home;
  const path = (p: string) => localizedPath(locale, p);
  const all = packages();
  const first = all[0];
  const licenses = [...new Set(all.map((p) => p.license))];
  const nodes = [...new Set(all.map((p) => p.node).filter((n): n is string => Boolean(n)))];

  const pillars = [
    { id: "ports", size: "lg", icon: <PackIcon size={22} />, ...t.pillars.ports },
    { id: "proven", size: "md", icon: <StudioIcon size={22} />, ...t.pillars.proven },
    { id: "released", size: "md", icon: <UserIcon size={22} />, ...t.pillars.released },
  ] as const;

  return (
    <main id="nd-page" className="jh-home">
      <div>
        <PageHero
          eyebrow={t.hero.eyebrow}
          title={t.hero.title}
          lead={t.hero.lead}
          aside={<InstallTabs names={HERO_PACKAGE} locale={locale} />}
        >
          <div className="jh-actions">
            <Button asChild variant="primary" size="lg">
              <Link href={path("/start")}>
                {t.hero.start} <ForwardIcon size={16} aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="#packages">{t.hero.packages}</a>
            </Button>
          </div>
          <SpecimenTag
            className="jh-facts"
            fields={[
              { label: t.proofs.packages, value: String(all.filter((p) => p.version).length) },
              { label: t.proofs.license, value: licenses.join(" · ") },
              ...(nodes.length === 1
                ? [{ label: t.proofs.node, value: <span className="jh-mono">Node {nodes[0]}</span> }]
                : []),
            ]}
          />
        </PageHero>

        <Section id="features" eyebrow={t.pillars.eyebrow} title={t.pillars.title} lead={t.pillars.lead} reveal>
          <ul className="kz-tpl-bento">
            {pillars.map((f) => (
              <li key={f.id} data-size={f.size} data-reveal="">
                <span className="kz-block-icon" aria-hidden>
                  {f.icon}
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="packages"
          eyebrow={t.packages.eyebrow}
          title={format(t.packages.title, { count: String(all.length) })}
          lead={t.packages.lead}
          reveal
          divider
        >
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
                  facts={[
                    p.version
                      ? {
                          label: format(t.packages.published, { version: p.version }),
                          tone: "ok",
                          href: npmPackageUrl(p.name),
                        }
                      : { label: t.packages.unpublished, tone: "wip" },
                  ]}
                  more={{ href: path(`/${p.id}`), label: t.packages.details }}
                  linkAs={Link}
                />
              );
            })}
          </CardGrid>
        </Section>

        <Section id="go" eyebrow={t.go.eyebrow} title={t.go.title} reveal divider>
          <CardGrid min={260} columns={3}>
            <LinkCard
              href={REPOSITORY_URL}
              icon={<BookmarkIcon size={22} aria-hidden />}
              title={t.go.source.title}
              description={t.go.source.text}
            />
            <LinkCard
              href={NPM_ORG_URL}
              icon={<PackIcon size={22} aria-hidden />}
              title={t.go.npm.title}
              description={t.go.npm.text}
            />
            <LinkCard
              href={JAVA_URL}
              icon={<StudioIcon size={22} aria-hidden />}
              title={t.go.java.title}
              description={t.go.java.text}
            />
            <LinkCard
              href={UI_URL}
              icon={<GlobeIcon size={22} aria-hidden />}
              title={t.go.ui.title}
              description={t.go.ui.text}
            />
          </CardGrid>
        </Section>
        <Section spacing="sm" aria-labelledby="home-closing">
          <CtaPanel id="home-closing" title={t.closing.title} body={t.closing.body} reveal>
            <Button asChild variant="primary" size="lg">
              <Link href={path(`/${first.id}`)}>{t.closing.packages}</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href={REPOSITORY_URL}>
                {t.closing.source} <ExternalIcon size={16} aria-hidden />
              </a>
            </Button>
          </CtaPanel>
        </Section>
      </div>
    </main>
  );
}
