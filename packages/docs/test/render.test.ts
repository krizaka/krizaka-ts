import { describe, expect, it } from "vitest";

import { buildManual } from "../src/extract";
import { manualDocuments, slugOf } from "../src/index";
import { routeOf } from "../src/routes";
import { fixtureSources } from "./fixture";

describe("routes", () => {
  it("an app router file answers its folder's address, groups and slots left out, dynamic segments kept", () => {
    expect(routeOf("/a/app/[locale]/(app)/app/check/page.tsx", "/a/app/[locale]")).toBe("/app/check");
    expect(routeOf("/a/app/api/documents/[id]/route.ts", "/a/app")).toBe("/api/documents/[id]");
    expect(routeOf("/a/app/@modal/(x)/page.tsx", "/a/app")).toBe("/");
    expect(routeOf("/b/page.tsx", "/a/app")).toBeNull();
  });

  it("a page's slug is its route in words", () => {
    expect(slugOf("/app/documents/[id]")).toBe("app-documents-id");
    expect(slugOf("/docs/[...slug]")).toBe("docs-slug");
    expect(slugOf("/")).toBe("home");
  });
});

describe("manualDocuments", () => {
  const manual = buildManual(fixtureSources());

  it("writes each page in the reader's language, the « generated » flag set for the chip", () => {
    const [check] = manualDocuments(manual, "fr");
    expect(check).toMatchObject({ slug: "app-check", title: "Vérifier un document", generated: true, locale: "fr" });
    expect(check?.markdown).toContain("## Comment faire — Vérifier un bail");
    expect(check?.markdown).toContain("1. Connectez-vous.\n2. Déposez le bail.\n3. Lisez le rapport.");
    expect(check?.markdown).toContain("![Vérifier un bail](/journeys/start-a-check.webm)");
    expect(check?.markdown).toContain("- **kind** — obligatoire: Ce qu’est le document. (au choix `lease`, `invoice`)");
    expect(check?.markdown).toContain("- **note** — facultatif: Une note pour vous.");
    expect(check?.markdown).toContain("| `FILE_TOO_LARGE` | Le fichier dépasse 10 Mo. |");
  });

  it("writes the English page with the screen's errors and the administrator's settings", () => {
    const document = manualDocuments(manual, "en")[1];
    expect(document?.markdown).toContain(
      "## Messages you may see\n\n| | |\n| --- | --- |\n| `NOT_FOUND` | Not found. |",
    );
    expect(document?.markdown).toContain("## Settings (administrator)");
    expect(document?.markdown).toContain("Address: `/app/documents/[id]`");
    expect(document?.description).toBe("The document, its report | and its file.");
  });
});
