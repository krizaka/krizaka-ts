/** The longest utm value kept. */
// @fixed: a campaign tag or a source name is a short slug; 64 leaves room for « post_2026-11-17_launch » and bounds the key
export const UTM_MAX_LENGTH = 64;

const UTM_CHARSET = /^[a-z0-9_.-]+$/;

/**
 * A utm_source or utm_campaign value as a count key: lower-cased, only `a-z 0-9 _ . -`, at most 64 characters. Anything else (a
 * space, an `@`, a `/` or `:` that would make it a URL, an accent, a longer value) is REJECTED and gives `""`, never truncated or
 * cleaned: a half-kept value could still hold an address or a name, and a made-up value never becomes a new key.
 */
export function utmValue(value: string | null | undefined): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  return lower.length <= UTM_MAX_LENGTH && UTM_CHARSET.test(lower) ? lower : "";
}
