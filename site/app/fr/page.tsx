import Home from "@/app/components/Home";
import { homeMetadata } from "@/lib/seo";
import { jsonLd } from "@/lib/json-ld";
import { homeJsonLd } from "@/lib/seo";

export const generateMetadata = () => homeMetadata("fr");

export default function Page() {
  return (
    <>
      {homeJsonLd("fr").map((data, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
      ))}
      <Home locale="fr" />
    </>
  );
}
