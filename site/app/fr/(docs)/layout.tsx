import type { ReactNode } from "react";
import DocsShell from "../../components/DocsShell";

export default function DocsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <DocsShell locale="fr">{children}</DocsShell>;
}
