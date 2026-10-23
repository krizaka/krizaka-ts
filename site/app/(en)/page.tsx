import Home from "@/app/components/Home";
import { homeMetadata } from "@/lib/seo";
import { jsonLd } from "@/lib/json-ld";
import { homeJsonLd } from "@/lib/seo";

export const generateMetadata = () => homeMetadata("en");

export default function Page() {
  return (
    <>
      {homeJsonLd("en").map((data, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
      ))}
      <Home locale="en" />
    </>
  );
}
