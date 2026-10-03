import { expect, test, type Page } from "@playwright/test";

const localPassword = "BrowserLocalTest123!";
const accountPassword = "CloudAccountTest123!";

async function add(page: Page, title: string) {
  await page.getByRole("button", { name: "新增凭据" }).click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.getByLabel("标题").fill(title);
  await dialog.getByLabel("网站地址").fill("https://example.com");
  await dialog.getByLabel("用户名").fill("synthetic-test-user");
  await dialog.locator("#credential-password").fill("SyntheticPassword123!");
  await dialog.getByRole("button", { name: "保存凭据" }).click();
  await expect(dialog).toBeHidden();
}

test("approves a second browser, shares the vault key and decrypts changes in both directions", async ({ page: first, browser }) => {
  test.setTimeout(120_000);
  const email = `cross-${crypto.randomUUID()}@example.com`;
  await first.goto("/");
  await first.locator("#master-password").fill(localPassword);
  await first.getByRole("button", { name: "开始生成" }).click();
  await expect(first.locator(".app-main")).toBeVisible({ timeout: 30_000 });
  await add(first, "First device item");
  await first.getByRole("button", { name: /身份节点/ }).click();
  await first.getByPlaceholder("输入邮箱地址").fill(email);
  await first.getByPlaceholder("账户密码").fill(accountPassword);
  await first.getByRole("button", { name: "注册", exact: true }).click();
  const recovery = first.getByRole("dialog", { name: "离线恢复记录" });
  await expect(recovery).toBeVisible({ timeout: 30_000 });
  await recovery.getByLabel("我已将这份备用恢复码保存在安全的离线位置").check();
  await recovery.getByRole("button", { name: "完成" }).click();
  await expect(first.getByText(/已同步 · 版本/u).first()).toBeVisible({ timeout: 30_000 });

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await second.goto("/");
  await second.locator("#master-password").fill("SecondBrowserLocal123!");
  await second.getByText("已有手机密码库？连接已有账户").click();
  await second.locator("#cloud-account-email").fill(email);
  await second.locator("#cloud-account-password").fill(accountPassword);
  await second.getByRole("button", { name: "连接云端密码库" }).click();
  await expect(second.locator(".error-banner")).toContainText("批准此浏览器", { timeout: 30_000 });
  await expect(second.getByText(/浏览器指纹/u)).toBeVisible();

  await first.getByRole("button", { name: "设备同步", exact: true }).click();
  await first.locator('[aria-controls="trusted-device-network"]').click();
  await first.getByRole("button", { name: /批准加入同步 .*Web/u }).click();
  const approval = first.getByRole("dialog", { name: "批准加入同步" });
  const approved = first.waitForResponse((response) => response.url().includes("/approve") && response.status() === 200);
  await approval.getByRole("button", { name: "确认", exact: true }).click();
  await approved;
  await second.getByRole("button", { name: "连接云端密码库" }).click();
  await expect(second.locator(".app-main")).toBeVisible({ timeout: 30_000 });
  await expect(second.getByRole("button", { name: /编辑 First device item/u })).toBeVisible({ timeout: 30_000 });
  await add(second, "Second device item");
  await expect.poll(() => second.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("zero-vault.local.synced-timestamps.v1") ?? "{}")).length), { timeout: 30_000 }).toBe(2);
  await first.getByRole("button", { name: "立即同步", exact: true }).first().click();
  await expect.poll(() => first.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("zero-vault.local.synced-timestamps.v1") ?? "{}")).length), { timeout: 30_000 }).toBe(2);
  await secondContext.close();
});
