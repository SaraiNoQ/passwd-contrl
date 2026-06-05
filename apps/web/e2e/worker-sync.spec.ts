import { expect, test, type Page } from "@playwright/test";

const MASTER_PASSWORD = "WorkerSyncPassword123!";
const ACCOUNT_PASSWORD = "WorkerAccountPassword123!";

async function createVault(page: Page) {
  await page.goto("/");
  const passwordInput = page.locator("#master-password");
  await expect(passwordInput).toBeVisible({ timeout: 15_000 });
  await passwordInput.fill(MASTER_PASSWORD);
  await page.getByRole("button", { name: /创建密码库/ }).click();
  await expect(page.locator(".stats-grid")).toBeVisible({ timeout: 30_000 });
}

async function addCredential(
  page: Page,
  opts: { title: string; origin: string; username: string; password: string }
) {
  await page.getByRole("button", { name: "新增凭据" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("标题").fill(opts.title);
  await drawer.getByLabel("网站地址").fill(opts.origin);
  await drawer.getByLabel("用户名").fill(opts.username);
  await drawer.getByLabel("密码", { exact: true }).fill(opts.password);
  await drawer.getByRole("button", { name: "保存凭据" }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });
}

async function registerAccount(page: Page, email: string) {
  await page.getByRole("button", { name: "账户" }).click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("账户密码").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/已登录 · 版本 0/u).first()).toBeVisible({ timeout: 30_000 });
}

test("registers with the Worker API and completes two item-level syncs without false conflicts", async ({ page }) => {
  const email = `sync-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

  await createVault(page);
  await addCredential(page, {
    title: "Worker Sync Site",
    origin: "https://worker-sync.example.com",
    username: "worker-user@example.com",
    password: "WorkerSyncStrong!123"
  });
  await registerAccount(page, email);

  await page.getByRole("button", { name: "立即同步" }).click();
  await expect(page.getByText(/已同步 · 版本 1/u).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/冲突/u)).toHaveCount(0);

  const row = page.locator('.app-main [role="button"]').filter({ hasText: "Worker Sync Site" });
  await row.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const usernameField = drawer.getByLabel("用户名");
  await usernameField.clear();
  await usernameField.fill("worker-user-updated@example.com");
  await drawer.getByRole("button", { name: "保存修改" }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  await page.getByRole("button", { name: "立即同步" }).click();
  await expect(page.getByText(/已同步 · 版本 2/u).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/检测到冲突/u)).toHaveCount(0);
});
