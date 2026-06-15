import { test, expect } from "@playwright/test";
import {
  MASTER_PASSWORD,
  UPDATED_MASTER_PASSWORD,
  CREDENTIALS,
} from "./helpers/constants";
import {
  createVault,
  lockVault,
  unlockVault,
  navigateTo,
} from "./helpers/vault";
import { addCredential } from "./helpers/credentials";

// ─── Module I: Settings ───────────────────────────────────────────────────────

test.describe("Module I - Settings", () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "应用设置" }).click();
  });

  // I-01: Auto-lock timeout persists across page refresh
  test("I-01: Auto-lock timeout settings", async ({ page }) => {
    // Scope to the SECURITY section to avoid matching the sync interval select
    const securitySection = page.locator("section").filter({ hasText: "SECURITY" });
    const select = securitySection.getByRole("combobox");
    await expect(select).toBeVisible();

    const options = [
      { value: "60" },
      { value: "300" },
      { value: "600" },
      { value: "1800" },
    ];

    for (const opt of options) {
      await select.selectOption(opt.value);
      await expect(select).toHaveValue(opt.value);
    }

    // Verify persistence after refresh - vault always locks on reload (in-memory state)
    await page.reload();
    // Re-unlock the vault after reload
    await unlockVault(page);
    // Navigate back to settings
    await page.getByRole("button", { name: "应用设置" }).click();
    // Wait for the settings page to appear
    await expect(page.getByRole("heading", { name: "应用设置" })).toBeVisible({ timeout: 15_000 });
    const securitySectionAfter = page.locator("section").filter({ hasText: "SECURITY" });
    const selectAfter = securitySectionAfter.getByRole("combobox");
    await expect(selectAfter).toHaveValue("1800");
  });

  // I-02: Extension ID persistence
  test("I-02: Extension ID", async ({ page }) => {
    const extensionId = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars
    const input = page.getByPlaceholder("输入浏览器扩展 ID");
    await input.fill(extensionId);
    await page.getByRole("button", { name: "保存扩展 ID" }).click();

    // The button becomes disabled after saving (value matches), confirming save
    await expect(page.getByRole("button", { name: "保存扩展 ID" })).toBeDisabled({ timeout: 5000 });

    // Verify persistence after refresh - vault always locks on reload
    await page.reload();
    // Re-unlock the vault after reload
    await unlockVault(page);
    // Navigate back to settings
    await page.getByRole("button", { name: "应用设置" }).click();
    await expect(page.getByRole("heading", { name: "应用设置" })).toBeVisible({ timeout: 15_000 });
    const inputAfter = page.getByPlaceholder("输入浏览器扩展 ID");
    await expect(inputAfter).toHaveValue(extensionId);
  });

  // I-03: Auto-sync toggle and interval selection
  test("I-03: Auto-sync toggle and interval", async ({ page }) => {
    // The checkbox accessible name changes between "开启" and "关闭" when toggled.
    // Target the checkbox input within the sync section directly.
    const syncSection = page.locator("section").filter({ hasText: "SYNC" });
    const toggle = syncSection.locator('input[type="checkbox"]');
    await expect(toggle).toBeVisible();

    // Auto-sync is ON by default. Toggle it OFF.
    await toggle.click();

    // When toggled off, the sync interval select should be hidden
    const intervalSelect = syncSection.getByRole("combobox");
    await expect(intervalSelect).toBeHidden();

    // Toggle back ON
    await toggle.click();

    // Now the interval select should be visible again
    await expect(intervalSelect).toBeVisible();
    await intervalSelect.selectOption({ index: 1 });
  });

  // I-04: Change master password successfully
  test("I-04: Change master password", async ({ page }) => {
    await page.locator("#当前密码").fill(MASTER_PASSWORD);
    await page.locator("#新密码").fill(UPDATED_MASTER_PASSWORD);
    await page.locator("#确认新密码").fill(UPDATED_MASTER_PASSWORD);
    await page.getByRole("button", { name: "更新主密码" }).click();

    // Verify success
    await expect(page.getByText("主密码已更新")).toBeVisible({ timeout: 10000 });

    // Lock vault
    await lockVault(page);

    // Old password should fail
    const passwordInput = page.locator("#master-password");
    await expect(passwordInput).toBeVisible({ timeout: 15_000 });
    await passwordInput.fill(MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.getByText("主密码不正确")).toBeVisible({ timeout: 15_000 });

    // New password should succeed
    await unlockVault(page, UPDATED_MASTER_PASSWORD);

    // Verify we're back in the unlocked vault (app-main is visible after unlockVault)
    await expect(page.locator(".app-main")).toBeVisible();
  });

  // I-05: Wrong current password shows error
  test("I-05: Wrong current password error", async ({ page }) => {
    await page.locator("#当前密码").fill("wrong-password-123");
    await page.locator("#新密码").fill(UPDATED_MASTER_PASSWORD);
    await page.locator("#确认新密码").fill(UPDATED_MASTER_PASSWORD);
    await page.getByRole("button", { name: "更新主密码" }).click();

    await expect(page.getByText(/当前密码错误|密码不正确|incorrect/i)).toBeVisible({
      timeout: 5000,
    });
  });

  // I-06: New password mismatch shows error
  test("I-06: New password mismatch error", async ({ page }) => {
    await page.locator("#当前密码").fill(MASTER_PASSWORD);
    await page.locator("#新密码").fill(UPDATED_MASTER_PASSWORD);
    await page.locator("#确认新密码").fill("different-new-password");
    await page.getByRole("button", { name: "更新主密码" }).click();

    await expect(page.getByText("两次输入的新密码不一致")).toBeVisible({ timeout: 5000 });
  });

  // I-07: Delete account confirmation modal
  test("I-07: Delete account", async ({ page }) => {
    await page.getByRole("button", { name: "删除账户" }).click();

    // Confirmation modal appears - use specific dialog name to avoid matching 密码库状态
    const modal = page.getByRole("dialog", { name: "确认删除账户" });
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByText("此操作不可撤销", { exact: true })).toBeVisible();

    await modal.getByRole("button", { name: "确认删除" }).click();
  });

  // I-08: Import encrypted backup
  test("I-08: Import encrypted backup", async ({ page }) => {
    // Create a small dummy JSON backup file
    const backupContent = JSON.stringify({ items: [], version: 1 });
    const fileInput = page.locator('input[type="file"]');

    // Upload the backup file
    await fileInput.setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupContent),
    });

    // The import handler processes the file and shows feedback.
    // A dummy JSON without proper encryption format triggers an error alert.
    // Filter to the actual error banner, not the Next.js route announcer.
    await expect(
      page.getByRole("alert").filter({ hasText: /无效|导入|备份/ }),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ─── Module M: Export ─────────────────────────────────────────────────────────

test.describe("Module M - Export", () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addCredential(page, CREDENTIALS.login);
    await page.getByRole("button", { name: "应用设置" }).click();
  });

  // M-01: Export CSV with confirmation modal
  test("M-01: Export CSV", async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name: "导出 CSV" }).click();

        // Confirmation modal appears - use specific dialog name
        const modal = page.getByRole("dialog", { name: "确认导出 CSV" });
        await expect(modal).toBeVisible({ timeout: 5000 });

        await modal.getByRole("button", { name: "确认导出" }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  // M-02: Export encrypted backup
  test("M-02: Export encrypted backup", async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "导出加密内容" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  // M-03: Export selected CSV
  test("M-03: Export selected CSV", async ({ page }) => {
    // Navigate to credential list to select items
    await navigateTo(page, "密码列表");

    // Select the first credential checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();
    await checkbox.check();

    // Go back to settings
    await page.getByRole("button", { name: "应用设置" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name: "导出选中" }).click();

        // Confirmation modal may appear
        const modal = page.getByRole("dialog", { name: "确认导出 CSV" });
        if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
          await modal.getByRole("button", { name: "确认导出" }).click();
        }
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  // M-04: Export selected encrypted
  test("M-04: Export selected encrypted", async ({ page }) => {
    await navigateTo(page, "密码列表");

    const checkbox = page.locator('input[type="checkbox"]').first();
    await checkbox.check();

    await page.getByRole("button", { name: "应用设置" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "选中加密内容" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  // M-05: CSV export cancel
  test("M-05: CSV export cancel", async ({ page }) => {
    await page.getByRole("button", { name: "导出 CSV" }).click();

    // Modal appears - use specific dialog name
    const modal = page.getByRole("dialog", { name: "确认导出 CSV" });
    await expect(modal).toBeVisible({ timeout: 5000 });

    await modal.getByRole("button", { name: "取消" }).click();

    // Modal should close
    await expect(modal).toBeHidden({ timeout: 5000 });
  });
});
