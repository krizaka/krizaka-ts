import DocPage, { metadataOf, staticParamsOf } from "@/app/components/DocPage";

export const dynamicParams = false;
export const generateStaticParams = () => staticParamsOf("fr");

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props) {
  return metadataOf("fr", (await params).slug);
}

export default async function Page({ params }: Props) {
  return <DocPage locale="fr" slug={(await params).slug} />;
}
