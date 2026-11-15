import Home from "@/app/components/Home";
import { jsonLd } from "@/lib/json-ld";
import { homeJsonLd, homeMetadata } from "@/lib/seo";

export const generateMetadata = () => homeMetadata("en");

export default function Page() {
  return (
    <>
      {homeJsonLd("en").map((data) => {
        const json = jsonLd(data);
        return <script key={json} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
      })}
      <Home locale="en" />
    </>
  );
}
