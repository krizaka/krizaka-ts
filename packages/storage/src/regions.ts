/**
 * The country of each provider region (data: a new region is a line here, one table for every product, ADR-010). A region not listed
 * is unknown: nothing claims a country for it, and the generated residency text never says « Canada » for it.
 */
export const COUNTRY_OF_REGION: Readonly<Record<string, string>> = {
  // DigitalOcean (App Platform `tor`, managed databases and Spaces `tor1`): Toronto.
  tor: "CA",
  tor1: "CA",
  // AWS, Oracle and Azure Canadian regions.
  "ca-central-1": "CA",
  "ca-west-1": "CA",
  "ca-central": "CA",
  "ca-east": "CA",
  "ca-toronto-1": "CA",
  "ca-montreal-1": "CA",
  "canada-central": "CA",
  canadacentral: "CA",
  canadaeast: "CA",
  // OVHcloud Beauharnois (Québec).
  bhs: "CA",
  // Bunny Storage zones (`<region>.storage.bunnycdn.com`): none is Canadian.
  ny: "US",
  la: "US",
  de: "DE",
  uk: "GB",
  sg: "SG",
  se: "SE",
  // DigitalOcean regions a product might use later.
  nyc3: "US",
  sfo3: "US",
  ams3: "NL",
  fra1: "DE",
  lon1: "GB",
  sgp1: "SG",
  blr1: "IN",
  syd1: "AU",
};

export type Residency = "canada" | "elsewhere";

/** The ISO country of a provider region, or undefined when the region is not mapped. */
export const countryOf = (region: string): string | undefined => COUNTRY_OF_REGION[region.trim().toLowerCase()];

/** Canada only when the table says so; an unmapped region is « elsewhere », never a guess in Canada's favour. */
export const residencyOf = (region: string): Residency => (countryOf(region) === "CA" ? "canada" : "elsewhere");

/**
 * Residency of a configured store: the region AND the endpoint have to agree. A host that names a known region
 * (`nyc3.digitaloceanspaces.com`, `ny.storage.bunnycdn.com`) in another country than the region setting is the contradiction that
 * would let a text claim Canada falsely, so any known region label of the host that is not Canadian makes the answer « elsewhere ».
 * A Bunny-shaped zone (`http`) has no Canadian region, so it is never « canada ».
 */
export function residencyOfConfig(config: { provider: "http" | "s3"; endpoint: string; region: string }): Residency {
  if (config.provider === "http") return "elsewhere";
  const host = config.endpoint.replace(/^[a-z]+:\/\//i, "").split("/")[0]?.toLowerCase() ?? "";
  const labels = host.split(".").filter((label) => countryOf(label) !== undefined);
  if (labels.some((label) => countryOf(label) !== "CA")) return "elsewhere";
  return residencyOf(config.region);
}
