/* JSON-LD for a <script type="application/ld+json">: JSON.stringify alone lets a title or description containing
   `</script>` close the tag, so `<`, `>`, `&` and the two line separators are written as \u escapes (the same JSON,
   read the same by crawlers). */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, String.raw`\u003c`)
    .replace(/>/g, String.raw`\u003e`)
    .replace(/&/g, String.raw`\u0026`)
    .replace(/\u2028/g, String.raw`\u2028`)
    .replace(/\u2029/g, String.raw`\u2029`);
}
