/**
 * Where a webhook may be sent: an `https` address with a public host. A literal loopback, private, link-local or metadata address, a
 * `localhost`, a bare name, credentials in the URL: refused. (A name that resolves to a private address is the sender's to refuse at the
 * moment of the call: the product's `send` checks the address it connected to.)
 */
const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./,
  /^198\.1[89]\./,
  /^2(2[4-9]|[3-5]\d)\./,
];

export function endpointUrlProblem(raw: string): "NOT_A_URL" | "NOT_HTTPS" | "NOT_PUBLIC" | "CREDENTIALS" | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "NOT_A_URL";
  }
  if (url.protocol !== "https:") return "NOT_HTTPS";
  if (url.username || url.password) return "CREDENTIALS";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":"))
  )
    return "NOT_PUBLIC";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.some((re) => re.test(host))) return "NOT_PUBLIC";
  if (
    host.includes(":") &&
    (host === "::1" || host === "::" || /^(fc|fd|fe[89ab])/.test(host) || host.startsWith("::ffff:"))
  )
    return "NOT_PUBLIC";
  return null;
}
