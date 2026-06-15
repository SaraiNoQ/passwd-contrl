import { expect, test, type Page } from "@playwright/test";

const MASTER_PASSWORD = "WorkerSyncPassword123!";
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

async function addCredential(
  page: Page,
  opts: { title: string; origin: string; username: string; password: string }
) {
  await page.getByRole("button", { name: "新增凭据" }).click();
  const drawer = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("标题").fill(opts.title);
  await drawer.getByLabel("网站地址").fill(opts.origin);
  await drawer.getByLabel("用户名").fill(opts.username);
  await drawer.getByLabel("密码", { exact: true }).fill(opts.password);
  await drawer.getByRole("button", { name: "保存凭据" }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });
}

async function registerAccount(page: Page, email: string) {
  await page.getByRole("button", { name: /身份节点/ }).click();
  await page.getByPlaceholder("输入邮箱地址").fill(email);
  await page.getByPlaceholder("账户密码").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/已登录 · 版本 0/u).first()).toBeVisible({ timeout: 30_000 });
  // Dismiss recovery modal so subsequent clicks are not blocked
  const closeBtn = page.getByRole("button", { name: "关闭" });
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  }
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

  const row = page.getByRole('button', { name: /编辑 Worker Sync Site/ });
  await row.click();
  const drawer = page.locator('[role="dialog"][aria-modal="true"]');
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
