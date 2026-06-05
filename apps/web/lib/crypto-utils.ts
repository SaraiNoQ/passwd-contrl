/**
 * Shared cryptographic utilities used across the Web Vault.
 *
 * Single source of truth for base64url encoding, random bytes generation,
 * ArrayBuffer conversion, HTTP request helpers, and TextEncoder/Decoder.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── Base64url ────────────────────────────────────────────────────────────────

export const toBase64Url = (bytes: Uint8Array): string => {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

export const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

// ── Crypto Helpers ───────────────────────────────────────────────────────────

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const { buffer, byteOffset, byteLength } = bytes;
  return (buffer as ArrayBuffer).slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
};

export const encodeText = (text: string): Uint8Array => encoder.encode(text);

export const decodeText = (bytes: Uint8Array | ArrayBuffer): string => {
  if (bytes instanceof ArrayBuffer) {
    return decoder.decode(bytes);
  }
  return decoder.decode(bytes);
};

// ── API Client Helpers ───────────────────────────────────────────────────────

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const REQUEST_TIMEOUT_MS = 30_000;

type RequestJsonOptions = {
  acceptStatuses?: number[];
};

export const requestJson = async <T>(path: string, init?: RequestInit, options?: RequestJsonOptions): Promise<T> => {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {})
      }
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("request_timeout");
    }
    throw new Error("network_error");
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !options?.acceptStatuses?.includes(response.status)) {
    throw new Error(body.error ?? `request_failed_${response.status}`);
  }
  return body;
};
