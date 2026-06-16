import { test, expect } from "@playwright/test";
import { createVault } from "./helpers/vault";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the password generator page via sidebar. */
async function navigateToGenerator(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "密码生成", exact: true }).first().click();
  await page.waitForTimeout(300);
}

/** Read the current generated password text from the display area. */
async function getPasswordText(page: import("@playwright/test").Page): Promise<string> {
  const section = page.locator('[aria-label="生成的密码"]');
  const text = await section.locator("span").first().innerText();
  // The span may show "请至少选择一种字符类型" when no charset is selected
  return text;
}

// ---------------------------------------------------------------------------
// Module G: Password Generator
// ---------------------------------------------------------------------------

test.describe("Module G - Password Generator", () => {
  // G-01: Independent generator page, default 20-char password, strength indicator
  test("G-01: navigates to generator page with default password and strength", async ({
    page,
  }) => {
    await createVault(page);
    await navigateToGenerator(page);

    // Verify we are on the generator page
    await expect(page.getByText("密码生成器")).toBeVisible();
    await expect(page.getByText("PASSWORD GENERATOR")).toBeVisible();

    // Default password should be 20 characters
    const password = await getPasswordText(page);
    expect(password).toHaveLength(20);

    // Strength indicator should be visible
    await expect(
      page.getByRole("progressbar", { name: /密码强度/ }),
    ).toBeVisible();

    // Entropy badge should show a number
    const entropyBadge = page.locator('[class*="entropyBadge"]');
    await expect(entropyBadge).toBeVisible();
  });

  // G-02: Adjust length slider and toggle options
  test("G-02: adjusts length slider and toggles options", async ({ page }) => {
    await createVault(page);
    await navigateToGenerator(page);

    // Adjust length slider to 32
    const slider = page.getByRole("slider", { name: "密码长度" });
    await slider.fill("32");

    // The length value display should update
    await expect(page.getByText("32")).toBeVisible();

    // Verify checkboxes exist and are checked by default
    const upperCheckbox = page.locator("label").filter({ hasText: "大写字母" }).locator("input");
    const lowerCheckbox = page.locator("label").filter({ hasText: "小写字母" }).locator("input");
    const digitsCheckbox = page.locator("label").filter({ hasText: "数字" }).locator("input");
    const symbolsCheckbox = page.locator("label").filter({ hasText: "特殊符号" }).locator("input");

    await expect(upperCheckbox).toBeChecked();
    await expect(lowerCheckbox).toBeChecked();
    await expect(digitsCheckbox).toBeChecked();
    await expect(symbolsCheckbox).toBeChecked();

    // Toggle exclude similar characters
    const excludeSimilar = page.locator("label").filter({ hasText: "排除相似字符" }).locator("input[type='checkbox']");
    await excludeSimilar.check();
    await expect(excludeSimilar).toBeChecked();

    // Toggle exclude ambiguous characters
    const excludeAmbiguous = page.locator("label").filter({ hasText: "排除歧义字符" }).locator("input[type='checkbox']");
    await excludeAmbiguous.check();
    await expect(excludeAmbiguous).toBeChecked();

    // Password should still be generated with 32 chars
    const password = await getPasswordText(page);
    expect(password).toHaveLength(32);
  });

  // G-03: Regenerate produces different passwords
  test("G-03: regenerate button produces different passwords", async ({
    page,
  }) => {
    await createVault(page);
    await navigateToGenerator(page);

    const firstPassword = await getPasswordText(page);

    // Click regenerate multiple times and verify different passwords
    const regenerateBtn = page.getByRole("button", { name: "重新生成" });
    await expect(regenerateBtn).toBeEnabled();

    await regenerateBtn.click();
    await page.waitForTimeout(100);
    const secondPassword = await getPasswordText(page);

    await regenerateBtn.click();
    await page.waitForTimeout(100);
    const thirdPassword = await getPasswordText(page);

    // With 20-char passwords from a large charset, collisions are astronomically unlikely
    expect(secondPassword).not.toBe(firstPassword);
    expect(thirdPassword).not.toBe(secondPassword);
  });

  // G-04: Copy button shows "已复制" status
  test("G-04: copy button shows copied status", async ({ page, context }) => {
    await createVault(page);

    // Grant clipboard permissions so navigator.clipboard.writeText succeeds
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await navigateToGenerator(page);

    const copyBtn = page.getByRole("button", { name: "复制密码" });
    await expect(copyBtn).toBeEnabled();

    await copyBtn.click();

    // "已复制" toast should appear
    await expect(page.getByText("已复制")).toBeVisible({ timeout: 5_000 });

    // The button aria-label should change to "密码已复制"
    await expect(
      page.getByRole("button", { name: "密码已复制" }),
    ).toBeVisible();
  });

  // G-05: Generate multiple passwords, check history dropdown appears
  test("G-05: history dropdown appears after generating multiple passwords", async ({
    page,
  }) => {
    await createVault(page);
    await navigateToGenerator(page);

    // Generate a few passwords (regenerate pushes current into history)
    const regenerateBtn = page.getByRole("button", { name: "重新生成" });
    await regenerateBtn.click();
    await page.waitForTimeout(100);
    await regenerateBtn.click();
    await page.waitForTimeout(100);
    await regenerateBtn.click();
    await page.waitForTimeout(100);

    // History toggle should appear
    const historyToggle = page.getByRole("button", { name: /历史记录/ });
    await expect(historyToggle).toBeVisible();

    // Open history dropdown
    await historyToggle.click();

    // History items should be visible
    const historyDropdown = page.locator('[class*="historyDropdown"]');
    await expect(historyDropdown).toBeVisible();

    // Should have history entries (at least 2, since each regenerate pushes previous)
    const historyItems = historyDropdown.locator("button");
    const count = await historyItems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  // G-06: In credential drawer, click generate password button
  test("G-06: credential drawer generate password fills password field", async ({
    page,
  }) => {
    await createVault(page);

    // Open the credential create drawer
    await page.getByRole("button", { name: "新增凭据" }).click();
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer).toBeVisible();

    // Click the generate password button in the drawer
    const generateBtn = drawer.getByRole("button", { name: /生成密码/ });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // The password field should be filled with a 20+ char password
    const passwordField = drawer.locator("#credential-password");
    const value = await passwordField.inputValue();
    expect(value.length).toBeGreaterThanOrEqual(20);
  });

  // G-07: Uncheck all character sets shows warning
  test("G-07: unchecking all character sets shows warning", async ({ page }) => {
    await createVault(page);
    await navigateToGenerator(page);

    // Uncheck all character set checkboxes using force to bypass any
    // actionability issues from the label's background/border overlay.
    const upperCheckbox = page.locator("label").filter({ hasText: "大写字母" }).locator("input[type='checkbox']");
    const lowerCheckbox = page.locator("label").filter({ hasText: "小写字母" }).locator("input[type='checkbox']");
    const digitsCheckbox = page.locator("label").filter({ hasText: "数字" }).locator("input[type='checkbox']");
    const symbolsCheckbox = page.locator("label").filter({ hasText: "特殊符号" }).locator("input[type='checkbox']");

    await upperCheckbox.uncheck({ force: true });
    await lowerCheckbox.uncheck({ force: true });
    await digitsCheckbox.uncheck({ force: true });
    await symbolsCheckbox.uncheck({ force: true });

    // Warning message should appear. Filter by text to disambiguate from the
    // Next.js route announcer which also has role="alert".
    await expect(
      page.locator('[role="alert"]').filter({ hasText: "请至少选择一种字符类型" }),
    ).toBeVisible();

    // Regenerate button should be disabled
    const regenerateBtn = page.getByRole("button", { name: "重新生成" });
    await expect(regenerateBtn).toBeDisabled();

    // Copy button should be disabled
    const copyBtn = page.getByRole("button", { name: "复制密码" });
    await expect(copyBtn).toBeDisabled();
  });
});
