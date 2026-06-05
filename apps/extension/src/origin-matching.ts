import type { OriginMatchResult, VaultCredentialSessionItem } from "./messages";

export const isHttpsOrigin = (origin: string) => origin.startsWith("https://");

export const normalizeOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
};

/** Single-label hostnames that act as their own eTLD+1. */
const SINGLE_LABEL_TLDS = new Set(["localhost", "internal"]);

/** Extract the eTLD+1 (effective top-level domain + 1) from a hostname. */
export const getEtldPlus1 = (hostname: string): string => {
  const parts = hostname.split(".");
  if (parts.length < 2) return hostname;

  // Single-label TLDs like "localhost" — any subdomain maps to the base.
  // e.g. "sub.localhost" → "localhost"
  const lastPart = parts[parts.length - 1] ?? "";
  if (SINGLE_LABEL_TLDS.has(lastPart)) {
    return lastPart;
  }

  // Simple heuristic: take last two labels. Handles .com, .org, .co.uk (approximate).
  // For multi-part TLDs like .co.uk, we take last 3 parts if the second-to-last is a known ccSLD.
  const knownCcSLDs = ["co", "com", "net", "org", "gov", "edu", "ac"];
  if (parts.length >= 3) {
    const maybeCcSLD = parts[parts.length - 2] ?? "";
    if (knownCcSLDs.includes(maybeCcSLD)) {
      return parts.slice(-3).join(".");
    }
  }
  return parts.slice(-2).join(".");
};

/**
 * Check if a hostname contains punycode labels (IDN homograph attack vector).
 * Punycode labels start with "xn--".
 * Accepts a raw hostname string (before URL normalization).
 */
export const hasPunycode = (hostname: string): boolean => {
  return hostname.split(".").some((label) => label.startsWith("xn--"));
};

/**
 * Extract the raw hostname from an origin string without URL normalization
 * (which may decode punycode).
 */
const rawHostname = (origin: string): string => {
  try {
    const withoutProtocol = origin.replace(/^https?:\/\//, "");
    return withoutProtocol.split("/")[0]?.split(":")[0] ?? "";
  } catch {
    return "";
  }
};

/**
 * Simple character-level typosquatting detection.
 * Checks for common character swaps, insertions of visually similar characters.
 */
const SUSPICIOUS_CHAR_PAIRS: Array<[string, string]> = [
  ["0", "o"],
  ["1", "l"],
  ["rn", "m"],
  ["vv", "w"],
  ["cl", "d"],
];

export const hasTypoSquatting = (hostname: string, referenceHostname: string): boolean => {
  if (hostname === referenceHostname) return false;
  const hostBase = hostname.split(".").slice(0, -1).join(".");
  const refBase = referenceHostname.split(".").slice(0, -1).join(".");
  if (hostBase === refBase) return false;

  // If same eTLD+1 but different subdomain beyond the eTLD+1, check for char-level tricks
  // We only flag if the hostnames are very similar (Levenshtein-like check)
  // Simple approach: check if swapping suspicious char pairs produces a match
  for (const [from, to] of SUSPICIOUS_CHAR_PAIRS) {
    const swapped1 = hostBase.replace(new RegExp(from, "g"), to);
    const swapped2 = hostBase.replace(new RegExp(to, "g"), from);
    if (swapped1 === refBase || swapped2 === refBase) {
      return true;
    }
  }
  return false;
};

/**
 * Determine the match type between a tab origin and a credential origin.
 */
export const classifyOriginMatch = (tabOrigin: string, credentialOrigin: string): OriginMatchResult => {
  // Check for punycode FIRST using raw hostnames (before any URL normalization
  // which may decode or reject punycode domains).
  const rawTabHost = rawHostname(tabOrigin);
  const rawCredHost = rawHostname(credentialOrigin);

  if (!rawTabHost || !rawCredHost) {
    return "different";
  }

  if (hasPunycode(rawTabHost) || hasPunycode(rawCredHost)) {
    return "suspicious";
  }

  const normalizedTab = normalizeOrigin(tabOrigin);
  const normalizedCred = normalizeOrigin(credentialOrigin);

  if (!normalizedTab || !normalizedCred || !isHttpsOrigin(normalizedTab)) {
    return "different";
  }

  // Exact match
  if (normalizedTab === normalizedCred) {
    return "exact";
  }

  let tabHost: string;
  let credHost: string;
  try {
    tabHost = new URL(normalizedTab).hostname;
    credHost = new URL(normalizedCred).hostname;
  } catch {
    return "different";
  }

  const tabEtld1 = getEtldPlus1(tabHost);
  const credEtld1 = getEtldPlus1(credHost);

  // Different eTLD+1 = completely different
  if (tabEtld1 !== credEtld1) {
    return "different";
  }

  // Same eTLD+1 - check for typosquatting
  if (hasTypoSquatting(tabHost, credHost)) {
    return "suspicious";
  }

  // Same eTLD+1 but different host (e.g. login.example.com vs evil.example.com)
  return "similar";
};

export const exactOriginMatches = (origin: string, credentials: VaultCredentialSessionItem[]) => {
  const normalized = normalizeOrigin(origin);
  if (!normalized || !isHttpsOrigin(normalized)) {
    return [];
  }

  return credentials.filter((credential) => normalizeOrigin(credential.origin) === normalized);
};

/**
 * Classify all credentials against a tab origin and return only non-"different" matches,
 * annotated with their match type.
 */
export const classifyAllMatches = (
  tabOrigin: string,
  credentials: VaultCredentialSessionItem[]
): Array<VaultCredentialSessionItem & { matchType: OriginMatchResult }> => {
  const normalized = normalizeOrigin(tabOrigin);
  if (!normalized || !isHttpsOrigin(normalized)) {
    return [];
  }

  return credentials
    .map((credential) => ({
      ...credential,
      matchType: classifyOriginMatch(tabOrigin, credential.origin)
    }))
    .filter((c) => c.matchType !== "different");
};
