import { CodeBlock, CodeTabs } from "@krizaka/ui/code-block";
import { MANAGERS } from "@/lib/install";
import { getDictionary, type Locale } from "@/lib/i18n";

/* The install command in each package manager, as @krizaka/ui's tabs of copyable code blocks (the Maven · Gradle tabs of
   Krizaka Java's site, for npm). `names` is one package or several, separated by spaces. */
export default function InstallTabs({ names, locale }: { names: string; locale: Locale }) {
  const t = getDictionary(locale).install;
  return (
    <CodeTabs
      label={t.label}
      tabs={MANAGERS.map((m) => ({
        id: m.id,
        label: m.id,
        content: (
          <CodeBlock code={m.command(names)} language="bash" file={t.file} copyLabel={t.copy} copiedLabel={t.copied} />
        ),
      }))}
    />
  );
}
