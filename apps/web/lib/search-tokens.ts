/**
 * Client-side encrypted search token generation.
 *
 * Search tokens are HMAC-SHA256 digests keyed with the vault key.
 * The server stores these tokens alongside vault items and can perform
 * blind matching without ever seeing plaintext terms.
 *
 * Security properties:
 *  - Without the vault key, tokens reveal nothing about the plaintext.
 *  - The server learns which items share tokens (linkability) but not
 *    the underlying search terms.
 *  - Tokens are deterministic per (vault key, term) pair.
 */

import { encodeText, toArrayBuffer } from "./crypto-utils";
import type { UnlockedVault, VaultItem } from "./local-vault";
import { isLogin, isCreditCard } from "./item-types";
import type { CiphertextEnvelope } from "@zero-vault/shared";

const SEARCH_DOMAIN = "zero-vault:search:v1:";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract raw vault key bytes regardless of runtime. */
async function getVaultKeyBytes(vault: UnlockedVault): Promise<Uint8Array> {
  if (vault.runtime === "crypto-core-wasm") {
    return vault.key;
  }
  const raw = await globalThis.crypto.subtle.exportKey("raw", vault.key);
  return new Uint8Array(raw);
}

/**
 * Compute HMAC-SHA256(key, data) and return the lowercase hex digest.
 * Uses WebCrypto SubtleCrypto which is available in both runtimes.
 */
async function hmacSha256Hex(key: Uint8Array, data: string): Promise<string> {
  const keyBuffer = toArrayBuffer(key);
  const hmacKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    hmacKey,
    toArrayBuffer(encodeText(data))
  );
  const bytes = new Uint8Array(sig);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalize a raw term: lowercase, trim whitespace. */
function normalizeTerm(raw: string): string {
  return raw.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Term extraction
// ---------------------------------------------------------------------------

/**
 * Extract searchable lowercase terms from a vault item.
 * Login: title words, origin hostname labels, username parts.
 * Secure note: title words.
 * Credit card: title words, cardholderName, brand.
 */
export function extractSearchTerms(item: VaultItem): string[] {
  const terms = new Set<string>();

  // Title: split on non-word separators (all item types)
  for (const part of item.title.split(/[\s\-_.,;:!?()[\]{}<>|/@#$%^&*+=]+/)) {
    const norm = normalizeTerm(part);
    if (norm.length >= 2) terms.add(norm);
  }

  if (isLogin(item)) {
    // Origin: extract hostname labels, skip "www"
    try {
      const hostname = new URL(item.origin).hostname;
      for (const part of hostname.split(".")) {
        const norm = normalizeTerm(part);
        if (norm.length >= 2 && norm !== "www") terms.add(norm);
      }
    } catch {
      // Invalid URL -- no origin tokens (items created via CSV import may lack an origin)
    }

    // Username: split on common separators
    if (item.username) {
      for (const part of item.username.split(/[@\-_.,;:!#$%^&*+=]+/)) {
        const norm = normalizeTerm(part);
        if (norm.length >= 2) terms.add(norm);
      }
    }
  } else if (isCreditCard(item)) {
    // Cardholder name
    if (item.cardholderName) {
      for (const part of item.cardholderName.split(/[\s\-_.,;:!?()[\]{}<>|/@#$%^&*+=]+/)) {
        const norm = normalizeTerm(part);
        if (norm.length >= 2) terms.add(norm);
      }
    }
    // Brand
    if (item.brand) {
      const norm = normalizeTerm(item.brand);
      if (norm.length >= 2) terms.add(norm);
    }
  }
  // secure_note: only title words (already extracted above)

  return Array.from(terms);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate search tokens for a credential.
 *
 * Called during item sync to populate `encryptedSearchTokens`.
 * Each token is an HMAC-SHA256 digest of `"zero-vault:search:v1:" + term`
 * keyed with the vault key. The server stores these blobs as-is.
 */
export async function generateSearchTokens(
  vault: UnlockedVault,
  item: VaultItem
): Promise<CiphertextEnvelope[]> {
  const vaultKey = await getVaultKeyBytes(vault);
  const terms = extractSearchTerms(item);
  const tokens: CiphertextEnvelope[] = [];

  for (const term of terms) {
    const hex = await hmacSha256Hex(vaultKey, `${SEARCH_DOMAIN}${term}`);
    tokens.push({
      alg: "HMAC_SHA256",
      nonce: "AA", // unused for HMAC; valid base64url placeholder to satisfy the schema
      ciphertext: hex
    });
  }

  return tokens;
}

/**
 * Generate a search token hex string for a raw query string.
 *
 * The server matches this hex against the `ciphertext` field of stored
 * `encryptedSearchTokens` entries.
 *
 * Multiple query words each produce their own token -- this function
 * normalises and hashes a single term.
 */
export async function generateQueryToken(
  vault: UnlockedVault,
  query: string
): Promise<string> {
  const vaultKey = await getVaultKeyBytes(vault);
  const normalized = normalizeTerm(query);
  if (normalized.length < 2) {
    // Queries shorter than 2 chars cannot match any stored token (min term length is 2).
    return "";
  }
  return hmacSha256Hex(vaultKey, `${SEARCH_DOMAIN}${normalized}`);
}
