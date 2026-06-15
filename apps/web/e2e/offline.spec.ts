import { test, expect, type Page } from "@playwright/test";
import { createVault } from "./helpers/vault";
import { addCredential, openCredentialForEdit } from "./helpers/credentials";

// ---------------------------------------------------------------------------
// Helpers: offline / online simulation
// ---------------------------------------------------------------------------

async function goOffline(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { value: false, writable: true });
    window.dispatchEvent(new Event("offline"));
  });
}

async function goOnline(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { value: true, writable: true });
    window.dispatchEvent(new Event("online"));
  });
}

// ---------------------------------------------------------------------------
// Module Q: Offline
// ---------------------------------------------------------------------------

test.describe("Module Q: Offline", () => {
  test("Q-01: Offline detection shows offline indicator", async ({ page }) => {
    await createVault(page);

    // Navigate to sync panel to see offline status
    await page.getByRole("button", { name: "设备同步" }).click();
    await page.waitForTimeout(500);

    // Simulate going offline
    await goOffline(page);
    await page.waitForTimeout(500);

    // The sync panel should show offline notice text
    await expect(
      page.getByText(/离线|当前离线/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Q-02: Edit credential while offline", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      title: "Offline Edit Test",
      origin: "https://offline-edit.example.com",
      username: "offline-edit@example.com",
      password: "OfflineEditStrong!1",
    });

    // Go offline
    await goOffline(page);
    await page.waitForTimeout(500);

    // Edit the credential
    const drawer = await openCredentialForEdit(page, "Offline Edit Test");
    const usernameField = drawer.getByLabel("用户名");
    await usernameField.clear();
    await usernameField.fill("offline-updated@example.com");
    await drawer.getByRole("button", { name: "保存修改" }).click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    // Verify the credential still exists in the list after edit
    await expect(
      page.getByRole('button', { name: /编辑 Offline Edit Test/ })
    ).toBeVisible();

    // Go back online
    await goOnline(page);
  });

  test("Q-03: Delete credential while offline", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      title: "Offline Delete Test",
      origin: "https://offline-delete.example.com",
      username: "offline-delete@example.com",
      password: "OfflineDeleteStrong!1",
    });

    // Go offline
    await goOffline(page);
    await page.waitForTimeout(500);

    // Delete the credential via the article's delete button
    const row = page
      .locator('article')
      .filter({ hasText: "Offline Delete Test" });
    await row.getByLabel("删除").click();
    // Confirm deletion
    await page.getByRole("button", { name: "确认" }).click();

    // Verify the credential is removed locally
    await expect(
      page.getByRole('button', { name: /编辑 Offline Delete Test/ })
    ).toBeHidden({ timeout: 15_000 });

    // Go back online
    await goOnline(page);
  });

  test("Q-04: Reconnect triggers auto-sync attempt", async ({ page }) => {
    await createVault(page);

    // Go offline, make a change, then come back online
    await goOffline(page);
    await page.waitForTimeout(500);

    // Add a credential while offline
    await addCredential(page, {
      title: "Reconnect Sync Test",
      origin: "https://reconnect.example.com",
      username: "reconnect@example.com",
      password: "ReconnectStrong!1",
    });

    // Navigate to sync panel
    await page.getByRole("button", { name: "设备同步" }).click();
    await page.waitForTimeout(500);

    // Go back online
    await goOnline(page);
    await page.waitForTimeout(1000);

    // The sync panel should no longer show the offline notice
    await expect(
      page.getByText(/当前离线/)
    ).toBeHidden({ timeout: 10_000 });
  });

  test("Q-05: Sync attempt while offline shows offline message", async ({ page }) => {
    await createVault(page);

    // Go offline
    await goOffline(page);
    await page.waitForTimeout(500);

    // Navigate to sync panel
    await page.getByRole("button", { name: "设备同步" }).click();

    // The offline notice should be visible
    await expect(
      page.getByText(/离线|当前离线/).first()
    ).toBeVisible({ timeout: 10_000 });

    // Try clicking the sync button if it exists
    const syncButton = page.getByRole("button", { name: /同步/ }).first();
    if (await syncButton.isVisible()) {
      await syncButton.click();
      await page.waitForTimeout(500);
    }

    // The offline message should still be visible after attempting sync
    await expect(
      page.getByText(/当前离线/).first()
    ).toBeVisible();

    // Go back online
    await goOnline(page);
  });
});
