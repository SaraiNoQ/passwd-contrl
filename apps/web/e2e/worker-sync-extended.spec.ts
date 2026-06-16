import { expect, test, type Page } from "@playwright/test";

const MASTER_PASSWORD = "WorkerSyncExtPassword123!";
const ACCOUNT_PASSWORD = "WorkerAccountPassword123!";

async function createVault(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("zero-vault.")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  });
  await page.reload();
  const passwordInput = page.locator("#master-password");
  await expect(passwordInput).toBeVisible({ timeout: 15_000 });
  await passwordInput.fill(MASTER_PASSWORD);
  await page.getByRole("button", { name: /开始生成|创建密码库/ }).click();
  await expect(page.locator(".app-main")).toBeVisible({ timeout: 30_000 });
}

function uniqueEmail(): string {
  return `sync-ext-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function openAccountSection(page: Page) {
  const toggle = page.getByRole("button", { name: /身份节点/ });
  const emailInput = page.getByPlaceholder("输入邮箱地址");
  const logoutBtn = page.getByRole("button", { name: "退出登录" });
  const sectionBody = emailInput.or(logoutBtn);

  // If the section body is already visible, nothing to do.
  if (await sectionBody.isVisible().catch(() => false)) return;

  // Click the toggle to open the section.
  await toggle.click();
  // Wait for the section body to actually appear after clicking.
  await expect(sectionBody).toBeVisible({ timeout: 5_000 });
}

async function dismissRecoveryModal(page: Page) {
  const dialog = page.getByRole("dialog", { name: "离线恢复记录" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel("我已将这份备用恢复码保存在安全的离线位置").check();
  await dialog.getByRole("button", { name: "完成" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

async function registerAccount(page: Page, email: string, password: string) {
  await openAccountSection(page);
  await page.getByPlaceholder("输入邮箱地址").fill(email);
  await page.getByPlaceholder("账户密码").fill(password);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  if (password.length >= 12) {
    await dismissRecoveryModal(page);
  }
}

async function loginAccount(page: Page, email: string, password: string) {
  await openAccountSection(page);
  await page.getByPlaceholder("输入邮箱地址").fill(email);
  await page.getByPlaceholder("账户密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

// ---------------------------------------------------------------------------
// J-02: Registration with short password rejects
// ---------------------------------------------------------------------------

test("J-02 rejects registration when password is shorter than 12 characters", async ({
  page,
}) => {
  await createVault(page);
  await registerAccount(page, uniqueEmail(), "short1!");

  await expect(page.getByText("账户密码至少需要 12 个字符").first()).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// J-03: Login after logout
// ---------------------------------------------------------------------------

test("J-03 allows login after logout with correct credentials", async ({
  page,
}) => {
  const email = uniqueEmail();

  await createVault(page);
  await registerAccount(page, email, ACCOUNT_PASSWORD);
  await expect(page.getByText(/已登录 · 版本/u).first()).toBeVisible({
    timeout: 30_000,
  });

  // Logout
  await openAccountSection(page);
  await page.getByRole("button", { name: "退出登录" }).click();

  // Re-login
  await loginAccount(page, email, ACCOUNT_PASSWORD);
  await expect(page.getByText(/已登录 · 版本 \d/u).first()).toBeVisible({
    timeout: 30_000,
  });
});

// ---------------------------------------------------------------------------
// J-04: Login with wrong credentials shows error
// ---------------------------------------------------------------------------

test("J-04 shows error when logging in with wrong credentials", async ({
  page,
}) => {
  const email = uniqueEmail();

  await createVault(page);
  // Register first so the account exists
  await registerAccount(page, email, ACCOUNT_PASSWORD);
  await expect(page.getByText(/已登录 · 版本/u).first()).toBeVisible({
    timeout: 30_000,
  });

  // Logout
  await openAccountSection(page);
  await page.getByRole("button", { name: "退出登录" }).click();

  // Try logging in with wrong password
  await loginAccount(page, email, "WrongPassword123!");
  await expect(
    page.locator("[role='alert']").filter({ hasText: /登录失败|密码|credentials/i }),
  ).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// J-05: Logout clears user info, status becomes "仅本地"
// ---------------------------------------------------------------------------

test("J-05 logout clears user info and sets status to local-only", async ({
  page,
}) => {
  const email = uniqueEmail();

  await createVault(page);
  await registerAccount(page, email, ACCOUNT_PASSWORD);
  await expect(page.getByText(/已登录 · 版本/u).first()).toBeVisible({
    timeout: 30_000,
  });

  // Logout
  await openAccountSection(page);
  await page.getByRole("button", { name: "退出登录" }).click();

  // Status should revert to local-only
  await expect(page.getByText("仅本地").first()).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// J-08: Sync before login shows "同步需要登录"
// ---------------------------------------------------------------------------

test("J-08 shows sync-need-login message when syncing before login", async ({
  page,
}) => {
  await createVault(page);

  // Navigate to the dashboard where the "立即同步" quick-action button lives
  await page.getByRole("button", { name: "密码总览" }).click();
  await page.getByRole("button", { name: "立即同步" }).first().click();

  await expect(page.getByText("同步需要登录").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "请先在左侧账户区注册或登录后再同步。" }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// J-09: Sync without local vault shows "同步需要本地密码库"
// ---------------------------------------------------------------------------

// J-09: The sidebar (and thus the account section / sync button) is only
// rendered on the /vault route which requires a vault to exist. The scenario
// "register before vault creation" is not reachable through the current UI.
test.skip("J-09 shows sync-need-vault message when syncing without local vault", async ({
  page,
}) => {
  await page.goto("/");
  const passwordInput = page.locator("#master-password");
  await expect(passwordInput).toBeVisible({ timeout: 15_000 });

  const email = uniqueEmail();
  await openAccountSection(page);
  await page.getByPlaceholder("输入邮箱地址").fill(email);
  await page.getByPlaceholder("账户密码").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "注册" }).click();

  await expect(page.getByText(email)).toBeVisible({ timeout: 30_000 });

  await openAccountSection(page);
  await page.getByRole("button", { name: "立即同步" }).click();

  await expect(page.getByText("同步需要本地密码库").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "请先创建本地密码库后再同步。" }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// J-11: Sync status display — "仅本地" when not logged in, "已登录" when logged in
// ---------------------------------------------------------------------------

test.describe("J-11 sync status display", () => {
  test("shows local-only status before login", async ({ page }) => {
    await createVault(page);

    await expect(page.getByText("仅本地").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows logged-in status after registration", async ({ page }) => {
    const email = uniqueEmail();

    await createVault(page);
    await registerAccount(page, email, ACCOUNT_PASSWORD);

    await expect(page.getByText(/已登录 · 版本 \d/u).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

// ---------------------------------------------------------------------------
// J-12: SyncWorkspace layout — navigate to "同步与设备" page
// ---------------------------------------------------------------------------

test("J-12 navigates to SyncWorkspace and verifies layout", async ({
  page,
}) => {
  await createVault(page);

  await page.getByRole("button", { name: "设备同步" }).click();

  // SyncWorkspace header
  await expect(page.getByText("设备同步地图")).toBeVisible({
    timeout: 10_000,
  });

  // Topology nodes
  await expect(page.getByText("本地密码库").first()).toBeVisible();
  await expect(page.getByText("加密同步").first()).toBeVisible();
  await expect(page.getByText("可信设备").first()).toBeVisible();
  await expect(page.getByText("浏览器桥").first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// J-13: SyncPanel shows sync events after sync
// ---------------------------------------------------------------------------

test("J-13 SyncPanel shows sync events after a successful sync", async ({
  page,
}) => {
  const email = uniqueEmail();

  await createVault(page);
  await registerAccount(page, email, ACCOUNT_PASSWORD);
  await expect(page.getByText(/已登录 · 版本/u).first()).toBeVisible({
    timeout: 30_000,
  });

  // Navigate to SyncWorkspace
  await page.getByRole("button", { name: "设备同步" }).click();
  await expect(page.getByText("设备同步地图")).toBeVisible({
    timeout: 10_000,
  });

  // Trigger sync from the workspace (disambiguate from the sidebar's identical button)
  await page.getByLabel("设备同步地图").getByRole("button", { name: "立即同步" }).click();

  // Wait for sync to finish
  await expect(page.getByText(/已同步 · 版本 \d/u).first()).toBeVisible({
    timeout: 30_000,
  });

  // Verify the sync activity log section exists
  await expect(page.getByText("最近同步").first()).toBeVisible({
    timeout: 10_000,
  });
});
