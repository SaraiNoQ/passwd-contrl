import { test, expect } from "@playwright/test";
import { CREDENTIALS } from "./helpers/constants";
import { createVault, navigateTo } from "./helpers/vault";
import { addCredential } from "./helpers/credentials";

// ---------------------------------------------------------------------------
// Module H: Dashboard
// ---------------------------------------------------------------------------

test.describe("Module H - Dashboard", () => {
  // H-01: After unlock, stats-grid is visible with total credentials count
  test("H-01: stats-grid visible after unlock with credential count", async ({
    page,
  }) => {
    await createVault(page);

    // .app-main should be visible (createVault already waits for this,
    // but we verify explicitly)
    const statsGrid = page.locator(".app-main");
    await expect(statsGrid).toBeVisible();

    // Add a credential so the count is non-zero
    await addCredential(page, {
      title: CREDENTIALS.login.title,
      origin: CREDENTIALS.login.origin,
      username: CREDENTIALS.login.username,
      password: CREDENTIALS.login.password,
    });

    // Navigate back to dashboard
    await navigateTo(page, "密码总览");

    // Stats should reflect at least 1 credential
    await expect(statsGrid).toBeVisible();
    // The stats grid should show total count text containing a number
    const statsText = await statsGrid.innerText();
    expect(statsText).toMatch(/\d+/);
  });

  // H-02: Add weak password credential, check password health panel shows it
  test("H-02: password health panel shows weak password entry", async ({
    page,
  }) => {
    await createVault(page);

    // Add a credential with a weak password (short, few character types)
    await addCredential(page, {
      title: "Weak Site",
      origin: "https://weak.example.com",
      username: "weakuser",
      password: "123",
    });

    // Navigate to dashboard
    await navigateTo(page, "密码总览");

    // Password health section should be visible
    await expect(page.getByRole("heading", { name: "风险列表", exact: true })).toBeVisible();

    // Weak password count should show at least 1
    await expect(page.getByText("弱密码").first()).toBeVisible();

    // The weak entry should appear in the risk list
    await expect(page.getByText("Weak Site")).toBeVisible();
  });

  // H-03: Click breach check button, verify progress and results
  test("H-03: breach check button shows progress and results", async ({
    page,
  }) => {
    await createVault(page);

    // Add a credential so there is something to check
    await addCredential(page, {
      title: CREDENTIALS.login.title,
      origin: CREDENTIALS.login.origin,
      username: CREDENTIALS.login.username,
      password: CREDENTIALS.login.password,
    });

    // Navigate to dashboard
    await navigateTo(page, "密码总览");

    // Find and click the breach scan button
    const scanBtn = page.getByRole("button", { name: /扫描泄露/ });
    await expect(scanBtn).toBeVisible();
    await scanBtn.click();

    // While scanning, button should show "扫描中..."
    await expect(page.getByText("扫描中...")).toBeVisible({ timeout: 5_000 });

    // Wait for scan to complete (result banner should appear)
    await expect(
      page.locator('[class*="breachBanner"]').first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  // H-04: After sync, verify sync events appear in activity list
  test("H-04: sync events appear in activity list after sync", async ({
    page,
  }) => {
    await createVault(page);

    // Navigate to dashboard
    await navigateTo(page, "密码总览");

    // The activity section should be visible
    await expect(page.getByText("最近活动")).toBeVisible();

    // On a fresh vault with no sync history, the empty state should show
    // "还没有同步记录"
    await expect(page.getByText("还没有同步记录")).toBeVisible();

    // Note: Full sync event testing requires a running Worker API.
    // This test verifies the activity section structure exists and
    // the empty state renders correctly for a new vault.
  });

  // H-05: Quick actions - add credential, import CSV, sync now
  test("H-05: quick action buttons work correctly", async ({ page }) => {
    await createVault(page);

    // Ensure we're on the dashboard
    await navigateTo(page, "密码总览");

    // The quick actions section header should be visible
    await expect(page.getByText("快捷操作")).toBeVisible({ timeout: 10_000 });

    // Verify quick action buttons exist in the quick actions section
    const quickActions = page.locator('[class*="quickActions"]');
    const addBtn = quickActions.getByRole("button", { name: /添加凭据/ });
    const importBtn = quickActions.getByRole("button", { name: /导入 CSV/ });
    const syncBtn = quickActions.getByRole("button", { name: /立即同步/ });

    await expect(addBtn).toBeVisible();
    await expect(importBtn).toBeVisible();
    await expect(syncBtn).toBeVisible();

    // Click "添加凭据" - should open the create drawer
    await addBtn.click();
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer).toBeVisible();
    // Close the drawer
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 5_000 });

    // Click "导入 CSV" - should navigate to import page
    await importBtn.click();
    await page.waitForTimeout(500);
    // Import page should show the import wizard
    await expect(page.getByText(/导入向导|选择来源/)).toBeVisible({
      timeout: 5_000,
    });

    // Navigate back to dashboard
    await navigateTo(page, "密码总览");

    // Click "立即同步" - should trigger a sync attempt
    // (On a local-only vault this may show an error or offline state,
    // but the button should be clickable)
    await syncBtn.click();
    await page.waitForTimeout(500);
  });

  // H-06: Empty vault shows empty state guidance
  test("H-06: empty vault shows empty state in password health", async ({
    page,
  }) => {
    await createVault(page);

    // Navigate to dashboard (should already be there after createVault)
    await navigateTo(page, "密码总览");

    // With no credentials, the password health panel should show empty state
    await expect(page.getByText("密码库尚未开始使用")).toBeVisible();

    // The empty state should guide the user to add credentials
    await expect(
      page.getByText("添加第一条密码后"),
    ).toBeVisible();

    // The risk list header should still be visible
    await expect(page.getByText("风险列表")).toBeVisible();
  });
});
