export { toBase64Url, fromBase64Url, randomBytes, toArrayBuffer, encodeText, decodeText } from "@zero-vault/browser-vault/crypto-utils";

// ── API Client Helpers ───────────────────────────────────────────────────────

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const REQUEST_TIMEOUT_MS = 30_000;

type RequestJsonOptions = {
  acceptStatuses?: number[];
};

type RequestRawOptions = {
  acceptStatuses?: number[];
};

async function requestRaw(path: string, init?: RequestInit, options?: RequestRawOptions): Promise<Response> {
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

  if (!response.ok && !options?.acceptStatuses?.includes(response.status)) {
    const errorResponse = typeof response.clone === "function" ? response.clone() : response;
    const body = (await errorResponse.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request_failed_${response.status}`);
  }

  return response;
}

export const requestJson = async <T>(path: string, init?: RequestInit, options?: RequestJsonOptions): Promise<T> => {
  const response = await requestRaw(path, init, options);

  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  return body;
};

export const requestBlob = async (path: string, init?: RequestInit, options?: RequestRawOptions): Promise<Blob> => {
  const response = await requestRaw(path, init, options);
  return response.blob();
};
