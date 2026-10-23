import type { ReactNode } from "react";
import SiteRoot from "../components/SiteRoot";

export default function EnglishLayout({ children }: { children: ReactNode }) {
  return <SiteRoot locale="en">{children}</SiteRoot>;
}
