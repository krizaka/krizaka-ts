/**
 * @krizaka/docs — the documentation module of every Krizaka product (krizaka-internal#763). This entry is what a product's code
 * imports: the `screen` builder and the types of a manual block, and the renderer of the manual's pages. The extractor, which needs
 * the TypeScript compiler, is `@krizaka/docs/extract` and runs only at build.
 */
export * from "./manual";
export * from "./render";
export { slugOf } from "./routes";
