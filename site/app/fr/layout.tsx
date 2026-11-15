import type { ReactNode } from "react";
import SiteRoot from "../components/SiteRoot";

export default function FrenchLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <SiteRoot locale="fr">{children}</SiteRoot>;
}
