import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileApiClient } from "../lib/api/mobile-api-client";
import {
  ACCOUNT_ID,
  DEVICE_ID,
  DEVICE_LOGIN,
  makePullResponse,
} from "./fixtures";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const SESSION_TOKEN = "S".repeat(43);
const PERSISTENT_TOKEN = "P".repeat(43);
const SCOPED_TOKEN = "T".repeat(43);
const LOGIN_SESSION_ID = "77777777-7777-4777-8777-777777777777";

const SESSION_RESPONSE = {
  user: { id: ACCOUNT_ID, email: "test@example.com", serverRevision: 4 },
  csrfToken: "csrf_token",
  sessionToken: SESSION_TOKEN,
  device: { id: DEVICE_ID, status: "approved" as const },
};

function ok(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function requestInit(callIndex: number): RequestInit {
  const init = mockFetch.mock.calls[callIndex]?.[1];
  if (!init) throw new Error(`missing fetch call ${callIndex}`);
  return init as RequestInit;
}

describe("MobileApiClient", () => {
  let client: MobileApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MobileApiClient({ baseUrl: "https://api.example.com///" });
  });

  it("normalizes the API base URL", () => {
    expect(client.getBaseUrl()).toBe("https://api.example.com");
  });

  it("sends the complete pre-generated device identity to mobile login finish", async () => {
    mockFetch.mockResolvedValueOnce(ok(SESSION_RESPONSE));

    const result = await client.loginFinish(
      LOGIN_SESSION_ID,
      "finish_login_request",
      DEVICE_LOGIN,
    );

    expect(result).toEqual(SESSION_RESPONSE);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://api.example.com/auth/mobile/login/finish");
    expect(JSON.parse(String(requestInit(0).body))).toEqual({
      loginSessionId: LOGIN_SESSION_ID,
      finishLoginRequest: "finish_login_request",
      device: DEVICE_LOGIN,
    });
  });

  it("rejects a mobile session response that omits device binding state", async () => {
    const { device: _device, ...incomplete } = SESSION_RESPONSE;
    mockFetch.mockResolvedValueOnce(ok(incomplete));

    await expect(
      client.loginFinish(LOGIN_SESSION_ID, "finish_login_request", DEVICE_LOGIN),
    ).rejects.toThrow();
  });

  it("uses an isolated temporary bearer without replacing the persistent bearer", async () => {
    client.setSessionToken(PERSISTENT_TOKEN);
    mockFetch
      .mockResolvedValueOnce(ok({ user: SESSION_RESPONSE.user, csrfToken: "temporary_csrf" }))
      .mockResolvedValueOnce(ok({ user: SESSION_RESPONSE.user, csrfToken: "persistent_csrf" }));

    await client.withSessionToken(SCOPED_TOKEN, async (scopedClient) => {
      expect(scopedClient).not.toBe(client);
      await scopedClient.fetchCurrentUser();
      await client.fetchCurrentUser();
    });

    expect(new Headers(requestInit(0).headers).get("authorization")).toBe(`Bearer ${SCOPED_TOKEN}`);
    expect(new Headers(requestInit(1).headers).get("authorization")).toBe(`Bearer ${PERSISTENT_TOKEN}`);
  });

  it("does not leak a temporary bearer when its operation fails", async () => {
    client.setSessionToken(PERSISTENT_TOKEN);
    await expect(
      client.withSessionToken(SCOPED_TOKEN, async () => {
        throw new Error("native_commit_failed");
      }),
    ).rejects.toThrow("native_commit_failed");

    mockFetch.mockResolvedValueOnce(ok({ user: SESSION_RESPONSE.user, csrfToken: "persistent_csrf" }));
    await client.fetchCurrentUser();
    expect(new Headers(requestInit(0).headers).get("authorization")).toBe(`Bearer ${PERSISTENT_TOKEN}`);
  });

  it("maps a caller abort to operation_cancelled", async () => {
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal;
      if (!signal) return reject(new Error("missing_abort_signal"));
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }));
    const controller = new AbortController();
    const pending = client.loginStart("test@example.com", "start_login_request", controller.signal);

    controller.abort();
    await expect(pending).rejects.toThrow("operation_cancelled");
  });

  it("keeps caller abort active while the response body is still streaming", async () => {
    let bodyStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        bodyStarted?.();
        const signal = init.signal;
        if (!signal) return reject(new Error("missing_abort_signal"));
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }),
    }));
    const controller = new AbortController();
    const pending = client.loginStart("test@example.com", "start_login_request", controller.signal);

    await started;
    controller.abort();
    await expect(pending).rejects.toThrow("operation_cancelled");
  });

  it("maps transport failures and HTTP authentication failures", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.fetchCurrentUser()).rejects.toThrow("network_error");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "invalid_device_credential" }),
    });
    await expect(client.fetchCurrentUser()).rejects.toThrow("invalid_device_credential");
  });

  it("invalidates bearer requests on 401 without treating anonymous auth as a session", async () => {
    const onSessionInvalidated = vi.fn();
    client.setSessionInvalidationHandler(onSessionInvalidated);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "invalid_credentials" }),
    });
    await expect(client.loginStart("test@example.com", "start_login_request"))
      .rejects.toThrow("invalid_credentials");
    expect(onSessionInvalidated).not.toHaveBeenCalled();

    client.setSessionToken(PERSISTENT_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "not_authenticated" }),
    });
    await expect(client.fetchCurrentUser()).rejects.toThrow("not_authenticated");
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    expect(onSessionInvalidated).toHaveBeenCalledWith(PERSISTENT_TOKEN);
  });

  it("identifies a Worker that has not deployed mobile registration", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "not_found" }),
    });

    await expect(client.mobileRegisterFinish({} as never))
      .rejects.toThrow("mobile_registration_unavailable");
  });

  it("uses a numeric cursor and accepts only the complete strict pull response", async () => {
    const response = makePullResponse({ serverRevision: 8, cursor: 12 });
    mockFetch.mockResolvedValueOnce(ok(response));

    expect(await client.pullItems(7)).toEqual(response);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://api.example.com/vault/item-sync?cursor=7");

    const { deletedItems: _deletedItems, ...incomplete } = response;
    mockFetch.mockResolvedValueOnce(ok(incomplete));
    await expect(client.pullItems(12)).rejects.toThrow();
  });

  it("loads item history through the strict authenticated endpoint", async () => {
    const itemId = "a0000000-0000-4000-8000-000000000001";
    mockFetch.mockResolvedValueOnce(ok({ itemId, versions: [] }));

    expect(await client.fetchItemHistory(itemId)).toEqual({ itemId, versions: [] });
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.com/vault/items/${itemId}/history`,
    );

    mockFetch.mockResolvedValueOnce(ok({ itemId, versions: [{}] }));
    await expect(client.fetchItemHistory(itemId)).rejects.toThrow();
  });

  it("sends CSRF on logout and clears the persistent bearer", async () => {
    client.setSessionToken(PERSISTENT_TOKEN);
    mockFetch
      .mockResolvedValueOnce(ok({ ok: true }))
      .mockResolvedValueOnce(ok({ user: SESSION_RESPONSE.user, csrfToken: "after_logout" }));

    await client.logout("csrf_token");
    expect(new Headers(requestInit(0).headers).get("x-zero-vault-csrf")).toBe("csrf_token");
    await client.fetchCurrentUser();
    expect(new Headers(requestInit(1).headers).get("authorization")).toBeNull();
  });

  it("deletes the account with CSRF and clears the persistent bearer", async () => {
    client.setSessionToken(PERSISTENT_TOKEN);
    mockFetch
      .mockResolvedValueOnce(ok({ ok: true }))
      .mockResolvedValueOnce(ok({ user: SESSION_RESPONSE.user, csrfToken: "after_delete" }));

    await client.deleteAccount("csrf_token");
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://api.example.com/auth/account");
    expect(requestInit(0).method).toBe("DELETE");
    expect(new Headers(requestInit(0).headers).get("x-zero-vault-csrf")).toBe("csrf_token");
    await client.fetchCurrentUser();
    expect(new Headers(requestInit(1).headers).get("authorization")).toBeNull();
  });

  it("uploads and downloads only the native encrypted backup format", async () => {
    const exportId = "e0000000-0000-4000-8000-000000000001";
    const snapshot = JSON.stringify({ format: "zero-vault-mobile-encrypted-backup", version: 1 });
    client.setSessionToken(PERSISTENT_TOKEN);
    mockFetch
      .mockResolvedValueOnce(ok({ ok: true, key: `exports/${ACCOUNT_ID}/${exportId}`, size: snapshot.length }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "x-export-algorithm": "ZERO_VAULT_MOBILE_BACKUP_V2" }),
        text: () => Promise.resolve(snapshot),
      });

    await client.createCloudBackup("csrf_token", exportId, snapshot);
    expect(requestInit(0).body).toBe(snapshot);
    expect(new Headers(requestInit(0).headers).get("x-export-algorithm"))
      .toBe("ZERO_VAULT_MOBILE_BACKUP_V2");
    expect(await client.downloadCloudBackup(exportId)).toBe(snapshot);
    expect(new Headers(requestInit(1).headers).get("authorization")).toBe(`Bearer ${PERSISTENT_TOKEN}`);
  });

  it("fails closed when a downloaded cloud backup uses another format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "x-export-algorithm": "XCHACHA20_POLY1305" }),
      text: () => Promise.resolve("ciphertext"),
    });
    await expect(client.downloadCloudBackup("e0000000-0000-4000-8000-000000000001"))
      .rejects.toThrow("cloud_backup_incompatible");
  });
});
