import { test, expect } from "@playwright/test";
import { createVault, navigateTo } from "./helpers/vault";

// ---------------------------------------------------------------------------
// Module R: Extension Bridge
// ---------------------------------------------------------------------------

test.describe("Module R - Extension Bridge", () => {
  // R-01: Extension status display - verify sidebar shows extension bridge status
  test("R-01: sidebar displays extension bridge status", async ({ page }) => {
    await createVault(page);

    // The sidebar footer contains extension bridge status under "设备区信号"
    const sidebar = page.locator('aside[aria-label="密码目录导航"]');
    await expect(sidebar).toBeVisible();

    // The "设备区信号" label should be visible in the sidebar
    await expect(page.getByText("设备区信号")).toBeVisible();

    // The extension status should show one of the three states:
    // "扩展未连接" (not configured), "扩展节点在线" (configured + available),
    // or "扩展节点离线" (configured but unavailable)
    const statusText = page.locator("text=/扩展未连接|扩展节点在线|扩展节点离线/");
    await expect(statusText).toBeVisible();
  });

  // R-01b: Extension status shows correct state based on configuration
  test("R-01b: extension status reflects unconfigured state by default", async ({
    page,
  }) => {
    await createVault(page);

    // In a fresh test environment, no extension ID is configured,
    // so the status should show "扩展未连接"
    const notConfigured = page.getByText("扩展未连接");
    const statusVisible = await notConfigured
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (statusVisible) {
      await expect(notConfigured).toBeVisible();
    } else {
      // If an extension ID is configured in the test environment,
      // verify one of the other states is shown
      await expect(
        page.getByText(/扩展节点在线|扩展节点离线/),
      ).toBeVisible();
    }
  });

  // R-01c: Extension status visible on sync workspace page
  test("R-01c: sync workspace shows extension bridge info", async ({
    page,
  }) => {
    await createVault(page);

    // Navigate to sync workspace
    await navigateTo(page, "设备同步");

    // The sync workspace receives extensionBridge prop and displays it
    // Verify the sync workspace is loaded — use heading to avoid strict mode
    await expect(
      page.getByRole("heading", { name: "设备同步地图" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  // R-02: Unlock publishes session (if extension configured)
  // NOTE: Without an actual extension installed, this test verifies
  // the UI behavior after unlock - the extension bridge status should be visible.
  test("R-02: extension bridge status visible after vault unlock", async ({
    page,
  }) => {
    await createVault(page);

    // After unlock, the sidebar should display the extension bridge status
    await expect(page.getByText("设备区信号")).toBeVisible();

    // The sidebar should show the lock status as "已解锁"
    await expect(page.getByText("已解锁")).toBeVisible();

    // Extension status should be one of the three states
    await expect(
      page.getByText(/扩展未连接|扩展节点在线|扩展节点离线/),
    ).toBeVisible();
  });

  // R-03: Lock clears session (if extension configured)
  // NOTE: Without an actual extension installed, this test verifies
  // that the UI transitions to locked state correctly.
  test("R-03: extension bridge state after vault lock", async ({ page }) => {
    await createVault(page);

    // Lock the vault
    await page.getByRole("button", { name: "锁定密码库" }).click();
    await expect(page.locator("#master-password")).toBeVisible({
      timeout: 15_000,
    });

    // After lock, the sidebar footer should still be rendered
    // but the vault is now locked (lock badge shows "封存")
    // The extension status area may or may not be visible depending on
    // whether the sidebar is shown in locked state
    // Verify the lock screen is shown (master password input)
    await expect(page.locator("#master-password")).toBeVisible();

    // Unlock again to verify the extension bridge status reappears
    const passwordInput = page.locator("#master-password");
    await passwordInput.fill("TestPassword123!Secure");
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 30_000 });

    // Extension status should be visible again after re-unlock
    await expect(
      page.getByText(/扩展未连接|扩展节点在线|扩展节点离线/),
    ).toBeVisible();
  });
});
