const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/**
 * The content type the BYTES say they are, by magic number, never by the file name: png, jpeg, gif, webp, pdf, mp4, webm and svg.
 * `null` when the bytes are none of these. An svg is text that opens with `<svg` (or an xml declaration followed by it).
 */
export function sniffType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(bytes, 4, 8) === "ftyp") return "video/mp4";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512)).replace(/^[\uFEFF]/, "").trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}
