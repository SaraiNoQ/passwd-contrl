import { expect, type Page } from "@playwright/test";
import { MASTER_PASSWORD } from "./constants";

/**
 * Navigate to /, fill the master password, create a new vault, and wait for
 * the unlocked UI (stats-grid) to appear.
 */
export async function createVault(
  page: Page,
  password: string = MASTER_PASSWORD,
): Promise<void> {
  // Clear any existing vault state to ensure a clean start
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
  await passwordInput.fill(password);
  const createButton = page.getByRole("button", { name: /开始生成|创建密码库/ });
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(page.locator(".app-main")).toBeVisible({ timeout: 30_000 });
}

/**
 * Fill the master password and click unlock. Waits for stats-grid.
 */
export async function unlockVault(
  page: Page,
  password: string = MASTER_PASSWORD,
): Promise<void> {
  const passwordInput = page.locator("#master-password");
  await expect(passwordInput).toBeVisible({ timeout: 15_000 });
  await passwordInput.fill(password);
  await page.getByRole("button", { name: /解锁密码库/ }).click();
  await expect(page.locator(".app-main")).toBeVisible({ timeout: 30_000 });
}

/**
 * Click the lock button in the sidebar to lock the vault.
 */
export async function lockVault(page: Page): Promise<void> {
  await page.getByRole("button", { name: "锁定密码库" }).click();
  await expect(page.locator("#master-password")).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate to a sidebar section by label text.
 */
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  // Wait a tick for the navigation to settle
  await page.waitForTimeout(300);
}
