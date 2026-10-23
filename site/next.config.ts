import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

/* A static site: `next build` writes out/ (HTML, CSS, JS, the search indexes), served as is — no server, no function.
   Every page has its own directory (`/web/index.html`), so any static host answers `/web/` and `/web`. English is at
   the root, French under /fr/. */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  // One 404 for both languages: they are two root layouts (app/(en), app/fr), so the global one is the way.
  experimental: { globalNotFound: true },
};

export default createMDX()(nextConfig);
