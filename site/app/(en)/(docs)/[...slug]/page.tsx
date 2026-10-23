import DocPage, { metadataOf, staticParamsOf } from "@/app/components/DocPage";

export const dynamicParams = false;
export const generateStaticParams = () => staticParamsOf("en");

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props) {
  return metadataOf("en", (await params).slug);
}

export default async function Page({ params }: Props) {
  return <DocPage locale="en" slug={(await params).slug} />;
}
