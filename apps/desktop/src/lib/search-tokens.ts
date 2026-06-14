/**
 * Client-side encrypted search token generation for the desktop app.
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

import type { CiphertextEnvelope, VaultItem } from "@zero-vault/shared";

const SEARCH_DOMAIN = "zero-vault:search:v1:";

function encodeText(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function hmacSha256Hex(key: Uint8Array, data: string): Promise<string> {
  const hmacKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    hmacKey,
    toArrayBuffer(encodeText(data)),
  );
  const bytes = new Uint8Array(sig);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeTerm(raw: string): string {
  return raw.toLowerCase().trim();
}

function isLogin(item: VaultItem): item is VaultItem & { type: "login" } {
  return item.type === "login";
}

function isCreditCard(item: VaultItem): item is VaultItem & { type: "credit_card" } {
  return item.type === "credit_card";
}

export function extractSearchTerms(item: VaultItem): string[] {
  const terms = new Set<string>();

  for (const part of item.title.split(/[\s\-_.,;:!?()[\]{}<>|/@#$%^&*+=]+/)) {
    const norm = normalizeTerm(part);
    if (norm.length >= 2) terms.add(norm);
  }

  if (isLogin(item)) {
    try {
      const hostname = new URL(item.origin).hostname;
      for (const part of hostname.split(".")) {
        const norm = normalizeTerm(part);
        if (norm.length >= 2 && norm !== "www") terms.add(norm);
      }
    } catch {
      // Invalid URL — no origin tokens.
    }

    if (item.username) {
      for (const part of item.username.split(/[@\-_.,;:!#$%^&*+=]+/)) {
        const norm = normalizeTerm(part);
        if (norm.length >= 2) terms.add(norm);
      }
    }
  } else if (isCreditCard(item)) {
    if (item.cardholderName) {
      for (const part of item.cardholderName.split(/[\s\-_.,;:!?()[\]{}<>|/@#$%^&*+=]+/)) {
        const norm = normalizeTerm(part);
        if (norm.length >= 2) terms.add(norm);
      }
    }
    if (item.brand) {
      const norm = normalizeTerm(item.brand);
      if (norm.length >= 2) terms.add(norm);
    }
  }

  return Array.from(terms);
}

export async function generateSearchTokens(
  vaultKey: Uint8Array,
  item: VaultItem,
): Promise<CiphertextEnvelope[]> {
  const terms = extractSearchTerms(item);
  const tokens: CiphertextEnvelope[] = [];

  for (const term of terms) {
    const hex = await hmacSha256Hex(vaultKey, `${SEARCH_DOMAIN}${term}`);
    tokens.push({
      alg: "HMAC_SHA256",
      nonce: "AA",
      ciphertext: hex,
    });
  }

  return tokens;
}

export async function generateQueryToken(
  vaultKey: Uint8Array,
  query: string,
): Promise<string> {
  const normalized = normalizeTerm(query);
  if (normalized.length < 2) {
    return "";
  }
  return hmacSha256Hex(vaultKey, `${SEARCH_DOMAIN}${normalized}`);
}
