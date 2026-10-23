import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

/* The search index of both languages, built once at build time and downloaded by the search dialog (static: no server).
   Results carry the reader's language (the dialog asks for its locale). */
export const dynamic = "force-static";
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
