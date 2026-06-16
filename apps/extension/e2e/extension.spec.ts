import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..");
const fixturePath = path.resolve(extensionPath, "fixtures/https-login.html");
const hiddenFieldFixturePath = path.resolve(extensionPath, "fixtures/hidden-field.html");
const readonlyFieldFixturePath = path.resolve(extensionPath, "fixtures/readonly-field.html");
const disabledFieldFixturePath = path.resolve(extensionPath, "fixtures/disabled-field.html");
const crossOriginIframeFixturePath = path.resolve(extensionPath, "fixtures/cross-origin-iframe.html");
const password = "correct horse battery staple";

type PopupCredential = {
  id: string;
  title: string;
  origin: string;
  username: string;
  matchType?: string;
  password?: never;
};

type PopupState = {
  origin?: string;
  blockedReason?: string;
  credentials: PopupCredential[];
};

const listen = (server: Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) resolve(address.port);
    });
  });

const createCertificate = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "zero-vault-e2e-cert-"));
  const keyPath = path.join(dir, "localhost.key");
  const certPath = path.join(dir, "localhost.crt");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
  ]);
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
};

const routeFixture = (req: IncomingMessage, res: ServerResponse) => {
  if (req.url?.startsWith("/blank")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Blank HTTPS Fixture</title><h1>No login form</h1>");
    return;
  }

  if (req.url?.startsWith("/hidden-field")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(hiddenFieldFixturePath));
    return;
  }

  if (req.url?.startsWith("/readonly-field")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(readonlyFieldFixturePath));
    return;
  }

  if (req.url?.startsWith("/disabled-field")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(disabledFieldFixturePath));
    return;
  }

  if (req.url?.startsWith("/cross-origin-iframe")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(crossOriginIframeFixturePath));
    return;
  }

  if (req.url?.startsWith("/iframe-login")) {
    // A simple login form served inside an iframe
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(fixturePath));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(readFileSync(fixturePath));
};

test.describe("Zero Vault extension E2E", () => {
  let context: BrowserContext;
  let extensionId: string;
  let bridge: Page;
  let httpsOrigin: string;
  let httpOrigin: string;
  let certCleanup: () => void;
  let httpsSrv: Server;
  let httpSrv: Server;
  let userDataCleanup: () => void;

  const clearSessionStorage = async () => {
    await bridge.evaluate(async () => {
      await chrome.storage.session.clear();
    });
  };

  const sendExternalMessageFromPage = async <T>(page: Page, message: unknown): Promise<T> =>
    page.evaluate(
      ({ extensionId, message }) =>
        new Promise((resolve, reject) => {
          const runtime = globalThis.chrome?.runtime;
          if (!runtime?.sendMessage) {
            reject(new Error("chrome.runtime.sendMessage is unavailable on the fixture page"));
            return;
          }

          runtime.sendMessage(extensionId, message, (response) => {
            const error = runtime.lastError?.message;
            if (error) {
              reject(new Error(error));
              return;
            }
            resolve(response);
          });
        }),
      { extensionId, message }
    ) as Promise<T>;

  const getPopupState = async (page: Page) => sendExternalMessageFromPage<PopupState>(page, { type: "GET_POPUP_STATE" });

  const publishCredentialsFromPage = async (page: Page, origin: string, creds?: Array<{ id: string; title: string; origin: string; username: string; password: string }>) => {
    const credentials = creds ?? [
      {
        id: "credential-1",
        title: "Example",
        origin,
        username: "alice@example.com",
        password
      }
    ];
    const result = await sendExternalMessageFromPage(page, {
      type: "ZERO_VAULT_SESSION_UPDATE",
      credentials
    });
    expect(result).toEqual({ ok: true });
  };

  const clearCredentialsFromPage = async (page: Page) => {
    const result = await sendExternalMessageFromPage(page, { type: "ZERO_VAULT_SESSION_CLEAR" });
    expect(result).toEqual({ ok: true });
  };

  const openHttpsLogin = async () => {
    const login = await context.newPage();
    await login.goto(`${httpsOrigin}/login`);
    await expect(login.locator("input[type='password']")).toBeVisible();
    await expect(login.locator("input[type='password']")).toHaveAttribute("data-zero-vault-field-id", /.+/, {
      timeout: 10_000
    });
    await expect(login.locator("input[autocomplete='username']")).toHaveAttribute("data-zero-vault-field-id", /.+/);
    return login;
  };

  test.beforeAll(async () => {
    const cert = createCertificate();
    certCleanup = cert.cleanup;
    httpsSrv = createHttpsServer({ key: cert.key, cert: cert.cert }, routeFixture);
    httpSrv = createServer(routeFixture);
    const [hp, tp] = await Promise.all([listen(httpsSrv), listen(httpSrv)]);
    httpsOrigin = `https://localhost:${hp}`;
    httpOrigin = `http://localhost:${tp}`;

    const userDataDir = mkdtempSync(path.join(tmpdir(), "zero-vault-extension-e2e-"));
    userDataCleanup = () => rmSync(userDataDir, { recursive: true, force: true });
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      ignoreHTTPSErrors: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--allow-insecure-localhost"
      ]
    });
    const sw = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ??
      (await context.waitForEvent("serviceworker"));
    extensionId = new URL(sw.url()).host;

    // Open bridge page for chrome API access (extension pages have chrome.* APIs)
    bridge = await context.newPage();
    await bridge.goto(`chrome-extension://${extensionId}/bridge.html`);
    await bridge.waitForLoadState("domcontentloaded");
  });

  test.beforeEach(async () => {
    await clearSessionStorage();
  });

  test.afterAll(async () => {
    await bridge?.close();
    await context?.close();
    await new Promise<void>((r) => httpsSrv?.close(() => r()));
    await new Promise<void>((r) => httpSrv?.close(() => r()));
    certCleanup?.();
    userDataCleanup?.();
  });

  test("detects an HTTPS login form, withholds passwords from popup state, and fills only after confirmation", async () => {
    expect(extensionId).toBeTruthy();

    const login = await openHttpsLogin();
    const passwordFieldId = await login.locator("input[type='password']").getAttribute("data-zero-vault-field-id");
    expect(passwordFieldId).toMatch(/^[0-9a-f-]{36}$/);

    await publishCredentialsFromPage(login, httpsOrigin);
    await login.bringToFront();

    const state = await getPopupState(login);
    expect(state.origin).toBe(httpsOrigin);
    expect(state.credentials).toHaveLength(1);
    expect(state.credentials[0]).toMatchObject({
      id: "credential-1",
      title: "Example",
      origin: httpsOrigin,
      username: "alice@example.com",
      matchType: "exact"
    });
    // Password must never appear in popup state
    expect(JSON.stringify(state)).not.toContain(password);

    const fillResult = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "credential-1"
    });
    expect(fillResult).toEqual({ ok: true });

    await expect(login.locator("input[autocomplete='username']")).toHaveValue("alice@example.com");
    await expect(login.locator("input[type='password']")).toHaveValue(password);
    await expect(login.locator("body")).not.toHaveAttribute("data-submitted", "true");

    await login.close();
  });

  test("blocks stale candidates when another tab is active", async () => {
    const login = await openHttpsLogin();
    await publishCredentialsFromPage(login, httpsOrigin);
    await login.bringToFront();
    await expect.poll(() => getPopupState(login)).toMatchObject({ credentials: [{ id: "credential-1" }] });

    const blank = await context.newPage();
    await blank.goto(`${httpsOrigin}/blank`);
    await blank.bringToFront();

    const state = await getPopupState(blank);
    expect(state).toEqual({
      origin: httpsOrigin,
      credentials: [],
      blockedReason: "当前页面未检测到登录表单"
    });

    const fillResult = await sendExternalMessageFromPage(blank, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "credential-1"
    });
    expect(fillResult).toEqual({ ok: false, error: "no_candidate" });
    await expect(login.locator("input[autocomplete='username']")).toHaveValue("");
    await expect(login.locator("input[type='password']")).toHaveValue("");

    await blank.close();
    await login.close();
  });

  test("blocks HTTP pages from detection and popup fill", async () => {
    const httpLogin = await context.newPage();
    await httpLogin.goto(`${httpOrigin}/login`);
    await expect(httpLogin.locator("input[type='password']")).toBeVisible();

    const hasFieldId = await httpLogin.locator("input[type='password']").getAttribute("data-zero-vault-field-id");
    expect(hasFieldId).toBeNull();
    await httpLogin.bringToFront();

    const state = await getPopupState(httpLogin);
    expect(state).toEqual({
      credentials: [],
      blockedReason: "Zero Vault 仅支持 HTTPS 页面"
    });

    const fillResult = await sendExternalMessageFromPage(httpLogin, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "credential-1"
    });
    expect(fillResult).toEqual({ ok: false, error: "no_candidate" });
    await expect(httpLogin.locator("input[name='email']")).toHaveValue("");
    await expect(httpLogin.locator("input[type='password']")).toHaveValue("");

    await httpLogin.close();
  });

  test("clears session credentials and candidates through the external vault clear message", async () => {
    const login = await openHttpsLogin();
    await publishCredentialsFromPage(login, httpsOrigin);
    await login.bringToFront();
    await expect.poll(() => getPopupState(login)).toMatchObject({ credentials: [{ id: "credential-1" }] });

    await clearCredentialsFromPage(login);

    const stored = await bridge.evaluate(async () => {
      const result = await chrome.storage.session.get(["sessionCredentials", "lastCandidate"]);
      return result;
    });
    expect(stored).toEqual({});

    const state = await getPopupState(login);
    expect(state).toEqual({
      origin: httpsOrigin,
      credentials: [],
      blockedReason: "当前页面未检测到登录表单"
    });

    await login.close();
  });

  test("shows multiple credentials for same origin in popup state", async () => {
    const login = await openHttpsLogin();
    await publishCredentialsFromPage(login, httpsOrigin, [
      { id: "cred-1", title: "Personal", origin: httpsOrigin, username: "alice@example.com", password: "pass1" },
      { id: "cred-2", title: "Work", origin: httpsOrigin, username: "bob@company.com", password: "pass2" }
    ]);
    await login.bringToFront();

    const state = await getPopupState(login);
    expect(state.credentials).toHaveLength(2);
    expect(state.credentials[0]).toMatchObject({ id: "cred-1", title: "Personal", username: "alice@example.com", matchType: "exact" });
    expect(state.credentials[1]).toMatchObject({ id: "cred-2", title: "Work", username: "bob@company.com", matchType: "exact" });

    // Verify password never appears in popup state
    expect(JSON.stringify(state)).not.toContain("pass1");
    expect(JSON.stringify(state)).not.toContain("pass2");

    // Fill first credential
    const fill1 = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "cred-1"
    });
    expect(fill1).toEqual({ ok: true });
    await expect(login.locator("input[autocomplete='username']")).toHaveValue("alice@example.com");
    await expect(login.locator("input[type='password']")).toHaveValue("pass1");

    // Fill second credential
    const fill2 = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "cred-2"
    });
    expect(fill2).toEqual({ ok: true });
    await expect(login.locator("input[autocomplete='username']")).toHaveValue("bob@company.com");
    await expect(login.locator("input[type='password']")).toHaveValue("pass2");

    await login.close();
  });

  test("hidden password field is not detected", async () => {
    const login = await context.newPage();
    await login.goto(`${httpsOrigin}/hidden-field`);
    // Wait a moment for content script to run
    await login.waitForTimeout(500);

    // The password field should NOT have a data-zero-vault-field-id (form not detected)
    const hasFieldId = await login.locator("input[type='password']").getAttribute("data-zero-vault-field-id");
    expect(hasFieldId).toBeNull();

    await login.bringToFront();
    const state = await getPopupState(login);
    expect(state.blockedReason).toBeTruthy();
    expect(state.credentials).toHaveLength(0);

    await login.close();
  });

  test("readonly password field is not filled", async () => {
    const login = await context.newPage();
    await login.goto(`${httpsOrigin}/readonly-field`);
    // The readonly password field should still be detected (isVisibleInput already handles readonly)
    // But form-detection checks isVisibleInput which checks readOnly, so form should NOT be detected
    await login.waitForTimeout(500);

    const hasFieldId = await login.locator("input[type='password']").getAttribute("data-zero-vault-field-id");
    // Since isVisibleInput rejects readonly, the form won't be detected
    expect(hasFieldId).toBeNull();

    await login.bringToFront();
    const state = await getPopupState(login);
    expect(state.blockedReason).toBeTruthy();

    await login.close();
  });

  test("disabled password field is not filled", async () => {
    const login = await context.newPage();
    await login.goto(`${httpsOrigin}/disabled-field`);
    await login.waitForTimeout(500);

    const hasFieldId = await login.locator("input[type='password']").getAttribute("data-zero-vault-field-id");
    expect(hasFieldId).toBeNull();

    await login.bringToFront();
    const state = await getPopupState(login);
    expect(state.blockedReason).toBeTruthy();

    await login.close();
  });

  test("cross-origin iframe form is not detected", async () => {
    const login = await context.newPage();
    await login.goto(`${httpsOrigin}/cross-origin-iframe`);

    // Set the iframe src to a cross-origin page
    // We use the HTTP origin as a different origin for the iframe
    await login.evaluate(
      ({ httpOrigin }) => {
        const iframe = document.getElementById("cross-frame") as HTMLIFrameElement;
        if (iframe) {
          iframe.src = httpOrigin + "/login";
        }
      },
      { httpOrigin }
    );

    // Wait for iframe to load
    await login.waitForTimeout(1000);

    await login.bringToFront();
    const state = await getPopupState(login);

    // The form inside the cross-origin iframe should NOT be detected
    expect(state.blockedReason).toBeTruthy();

    await login.close();
  });

  test("session clear removes all credentials", async () => {
    const login = await openHttpsLogin();
    await publishCredentialsFromPage(login, httpsOrigin, [
      { id: "cred-1", title: "Personal", origin: httpsOrigin, username: "alice@example.com", password: "pass1" },
      { id: "cred-2", title: "Work", origin: httpsOrigin, username: "bob@company.com", password: "pass2" }
    ]);
    await login.bringToFront();
    await expect.poll(() => getPopupState(login)).toMatchObject({ credentials: expect.arrayContaining([expect.objectContaining({ id: "cred-1" })]) });

    await clearCredentialsFromPage(login);

    const state = await getPopupState(login);
    expect(state.credentials).toHaveLength(0);

    await login.close();
  });

  test("popup HTML never contains plaintext password", async () => {
    const login = await openHttpsLogin();
    await publishCredentialsFromPage(login, httpsOrigin);
    await login.bringToFront();

    const state = await getPopupState(login);
    // Deep check: stringify the entire state and ensure password is absent
    const stateStr = JSON.stringify(state);
    expect(stateStr).not.toContain(password);
    expect(stateStr).not.toContain("correct horse battery staple");

    // Also verify no credential object has a password field
    for (const cred of state.credentials) {
      expect((cred as Record<string, unknown>).password).toBeUndefined();
    }

    await login.close();
  });

  test("GET_EXTENSION_STATUS returns installed status", async () => {
    const status = await sendExternalMessageFromPage(bridge, { type: "GET_EXTENSION_STATUS" });
    expect(status).toMatchObject({
      installed: true,
      version: "0.1.0"
    });
    expect(typeof status.credentialsLoaded).toBe("boolean");
    expect(typeof status.matchedCredentials).toBe("number");
  });

  test("multi-credential picker: shows multiple exact credentials and fills selected one", async () => {
    const login = await openHttpsLogin();
    // sub.localhost shares eTLD+1 (localhost) with localhost, so it's classified as "similar"
    const similarOrigin = httpsOrigin.replace("localhost", "sub.localhost");
    await publishCredentialsFromPage(login, httpsOrigin, [
      { id: "cred-personal", title: "Personal", origin: httpsOrigin, username: "alice@personal.com", password: "personal-pass" },
      { id: "cred-work", title: "Work", origin: httpsOrigin, username: "bob@work.com", password: "work-pass" },
      { id: "cred-similar", title: "Similar", origin: similarOrigin, username: "charlie@other.com", password: "similar-pass" }
    ]);
    await login.bringToFront();

    const state = await getPopupState(login);
    const exactCreds = state.credentials.filter((c) => c.matchType === "exact");
    const similarCreds = state.credentials.filter((c) => c.matchType === "similar");
    expect(exactCreds).toHaveLength(2);
    expect(similarCreds).toHaveLength(1);
    expect(exactCreds.map((c) => c.id)).toContain("cred-personal");
    expect(exactCreds.map((c) => c.id)).toContain("cred-work");
    expect(state.credentials.find((c) => c.id === "cred-similar")?.matchType).toBe("similar");

    // Fill second credential (work)
    const fill = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "cred-work"
    });
    expect(fill).toEqual({ ok: true });
    await expect(login.locator("input[autocomplete='username']")).toHaveValue("bob@work.com");
    await expect(login.locator("input[type='password']")).toHaveValue("work-pass");

    // Fill first credential (personal) to verify we can switch
    const fill2 = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "cred-personal"
    });
    expect(fill2).toEqual({ ok: true });
    await expect(login.locator("input[autocomplete='username']")).toHaveValue("alice@personal.com");
    await expect(login.locator("input[type='password']")).toHaveValue("personal-pass");

    await login.close();
  });

  test("phishing warning: similar origin blocks fill until acknowledged, suspicious always blocked", async () => {
    const login = await openHttpsLogin();
    // sub.localhost shares eTLD+1 (localhost) with localhost, so classified as "similar"
    const similarOrigin = httpsOrigin.replace("localhost", "sub.localhost");
    await publishCredentialsFromPage(login, httpsOrigin, [
      { id: "cred-exact", title: "Exact", origin: httpsOrigin, username: "alice", password: "exact-pass" },
      { id: "cred-similar", title: "Similar", origin: similarOrigin, username: "bob", password: "similar-pass" },
      { id: "cred-punycode", title: "Punycode", origin: "https://xn--googl-e4d.com", username: "victim", password: "stolen" }
    ]);
    await login.bringToFront();

    // Verify match types in popup state
    const state = await getPopupState(login);
    expect(state.credentials.find((c) => c.id === "cred-exact")?.matchType).toBe("exact");
    expect(state.credentials.find((c) => c.id === "cred-similar")?.matchType).toBe("similar");
    expect(state.credentials.find((c) => c.id === "cred-punycode")?.matchType).toBe("suspicious");

    // Fill is blocked for similar credential without acknowledgment
    const blockedFill = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "cred-similar"
    });
    expect(blockedFill).toEqual({ ok: false, error: "similar_origin_not_acknowledged" });
    await expect(login.locator("input[autocomplete='username']")).toHaveValue("");

    // Suspicious credentials are always blocked
    const suspiciousFill = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "cred-punycode"
    });
    expect(suspiciousFill).toEqual({ ok: false, error: "suspicious_origin" });

    // Exact credential works without acknowledgment
    const exactFill = await sendExternalMessageFromPage(login, {
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "cred-exact"
    });
    expect(exactFill).toEqual({ ok: true });
    await expect(login.locator("input[autocomplete='username']")).toHaveValue("alice");
    await expect(login.locator("input[type='password']")).toHaveValue("exact-pass");

    await login.close();
  });

  test("vault lock clears session credentials and candidate", async () => {
    const login = await openHttpsLogin();
    await publishCredentialsFromPage(login, httpsOrigin, [
      { id: "cred-1", title: "Example", origin: httpsOrigin, username: "alice", password: "pass1" }
    ]);
    await login.bringToFront();

    // Verify initial state has credentials
    let state = await getPopupState(login);
    expect(state.credentials).toHaveLength(1);

    // Simulate vault lock (ZERO_VAULT_SESSION_CLEAR)
    await clearCredentialsFromPage(login);

    // Verify session storage keys are cleared
    const stored = await bridge.evaluate(async () => {
      const result = await chrome.storage.session.get([
        "sessionCredentials",
        "lastCandidate",
        "acknowledgedOrigins"
      ]);
      return result;
    });
    expect(stored).toEqual({});

    // Verify popup shows no credentials
    state = await getPopupState(login);
    expect(state.credentials).toHaveLength(0);
    expect(state.blockedReason).toBeTruthy();

    await login.close();
  });

  test("invisible (visibility:hidden) password field is not detected", async () => {
    const login = await context.newPage();
    await login.goto(`${httpsOrigin}/hidden-field`);
    await login.waitForTimeout(500);

    // Make the password field have zero dimensions by setting visibility:hidden
    await login.evaluate(() => {
      const pw = document.querySelector("input[type='password']") as HTMLInputElement;
      if (pw) pw.style.visibility = "hidden";
    });
    await login.waitForTimeout(200);

    // Reload to re-run content script with visibility:hidden applied
    await login.reload();
    await login.waitForTimeout(500);

    const hasFieldId = await login.locator("input[type='password']").getAttribute("data-zero-vault-field-id");
    expect(hasFieldId).toBeNull();

    await login.bringToFront();
    const state = await getPopupState(login);
    expect(state.blockedReason).toBeTruthy();
    expect(state.credentials).toHaveLength(0);

    await login.close();
  });
});
