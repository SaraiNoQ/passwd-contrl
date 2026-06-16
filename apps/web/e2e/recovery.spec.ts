import { test, expect } from "@playwright/test";
import {
  MASTER_PASSWORD,
  RECOVERED_MASTER_PASSWORD,
  CREDENTIALS,
} from "./helpers/constants";
import {
  createVault,
  lockVault,
  navigateTo,
} from "./helpers/vault";
import { addCredential } from "./helpers/credentials";

// ─── Module L: Recovery ─────────────────────────────────────────────────────

test.describe("Module L - Recovery", () => {
  test("L-01: Generate recovery code shows code in <code> element", async ({
    page,
  }) => {
    await createVault(page);
    await navigateTo(page, "恢复备份");

    // Click the generate button
    await page.getByRole("button", { name: "生成恢复码" }).click();

    // Wait for code element to appear and have non-empty content
    const codeEl = page.locator("code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    await expect(codeEl).not.toBeEmpty();
  });

  test("L-02: Recovery code save flow — generate, save step, confirm", async ({
    page,
  }) => {
    await createVault(page);
    await navigateTo(page, "恢复备份");

    // Step 1: Generate
    await page.getByRole("button", { name: "生成恢复码" }).click();

    // Auto-advances to save step — code should be visible
    const codeEl = page.locator("code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const recoveryCode = await codeEl.innerText();
    expect(recoveryCode.length).toBeGreaterThan(0);

    // Step 2: Click "下一步" to advance to confirm step
    await page.getByRole("button", { name: "下一步" }).click();

    // Step 3: Verify confirm step appears with verification input
    const verifyInput = page.getByLabel("备用恢复码末尾 8 位");
    await expect(verifyInput).toBeVisible({ timeout: 5_000 });

    // Enter the last 8 characters of the recovery code
    const last8 = recoveryCode.slice(-8);
    await verifyInput.fill(last8);

    await expect(page.getByText("验证通过")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "确认保存" }).click();
    await expect(page.getByText("离线恢复记录已封存").first()).toBeVisible({ timeout: 10_000 });
  });

  // L-03 skipped: The recovery modal (RecoveryModal) only appears after server
  // registration (submitRegister), not after local vault creation (createVault).
  test.skip("L-03: Recovery code modal after registration", async ({
    page,
  }) => {
    await createVault(page);
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toContainText("离线恢复记录");
    const codeEl = modal.locator("code");
    await expect(codeEl).toBeVisible();
    await expect(codeEl).not.toBeEmpty();
    await modal.getByRole("button", { name: "复制恢复码" }).click();
    const checkbox = modal.getByRole("checkbox");
    await checkbox.check();
    const doneBtn = modal.getByRole("button", { name: "完成" });
    await expect(doneBtn).toBeEnabled();
    await doneBtn.click();
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });

  test("L-04: Use recovery code to restore vault and verify credentials", async ({
    page,
  }) => {
    await createVault(page);

    // Generate recovery code
    await navigateTo(page, "恢复备份");
    await page.getByRole("button", { name: "生成恢复码" }).click();

    const codeEl = page.locator("code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const recoveryCode = await codeEl.innerText();

    // Add credentials to verify they survive recovery
    await navigateTo(page, "密码列表");
    await addCredential(page, CREDENTIALS.login);

    // Lock the vault
    await lockVault(page);

    // Use recovery code to restore — the lock screen has an inline form, not a
    // modal dialog.  The toggle button reveals the form.
    await page
      .getByRole("button", { name: /使用恢复码/ })
      .click();

    // Fill in recovery code and new master password
    await page.locator("#vault-recovery-code").fill(recoveryCode);
    await page.getByLabel("新主密码").fill(RECOVERED_MASTER_PASSWORD);

    // Submit recovery
    await page.getByRole("button", { name: "恢复密码库" }).click();

    // Verify success message (use .first() to avoid strict mode violation —
    // the text appears in both a button and a status element)
    await expect(
      page.getByText(/密码库已恢复.*条凭据/).first(),
    ).toBeVisible({ timeout: 30_000 });
    const rotatedRecoveryDialog = page.getByRole("dialog", { name: "保存新的恢复码" });
    await expect(rotatedRecoveryDialog).toContainText("旧恢复码已失效");
    await rotatedRecoveryDialog
      .getByLabel("我已将这份备用恢复码保存在安全的离线位置")
      .check();
    await rotatedRecoveryDialog.getByRole("button", { name: "完成" }).click();
    await expect(rotatedRecoveryDialog).toBeHidden({ timeout: 5_000 });

    // Verify credentials are intact — after recovery the vault lands on the
    // dashboard, so navigate to the credential list to find the title.
    await navigateTo(page, "密码列表");
    await expect(page.getByText(CREDENTIALS.login.title)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("L-05: After recovery, old password fails and new password works", async ({
    page,
  }) => {
    await createVault(page);

    // Generate recovery code
    await navigateTo(page, "恢复备份");
    await page.getByRole("button", { name: "生成恢复码" }).click();

    const codeEl = page.locator("code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const recoveryCode = await codeEl.innerText();

    // Lock vault and recover
    await lockVault(page);
    await page
      .getByRole("button", { name: /使用恢复码/ })
      .click();

    await page.locator("#vault-recovery-code").fill(recoveryCode);
    await page.getByLabel("新主密码").fill(RECOVERED_MASTER_PASSWORD);
    await page.getByRole("button", { name: "恢复密码库" }).click();

    await expect(page.getByText(/密码库已恢复/).first()).toBeVisible({
      timeout: 30_000,
    });
    const rotatedRecoveryDialog = page.getByRole("dialog", { name: "保存新的恢复码" });
    await expect(rotatedRecoveryDialog).toContainText("旧恢复码已失效");
    await rotatedRecoveryDialog
      .getByLabel("我已将这份备用恢复码保存在安全的离线位置")
      .check();
    await rotatedRecoveryDialog.getByRole("button", { name: "完成" }).click();
    await expect(rotatedRecoveryDialog).toBeHidden({ timeout: 5_000 });

    // Lock the vault again
    await lockVault(page);

    // Old password should fail
    const passwordInput = page.locator("#master-password");
    await passwordInput.fill(MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.getByText(/密码不正确|incorrect|失败/i)).toBeVisible({
      timeout: 10_000,
    });

    // New recovered password should work
    await passwordInput.fill(RECOVERED_MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 30_000 });
  });

  test("L-06: Invalid recovery code shows error", async ({ page }) => {
    await createVault(page);

    // Generate a recovery code so a packet exists
    await navigateTo(page, "恢复备份");
    await page.getByRole("button", { name: "生成恢复码" }).click();
    const codeEl = page.locator("code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });

    // Lock vault
    await lockVault(page);

    // Try to recover with invalid code
    await page
      .getByRole("button", { name: /使用恢复码/ })
      .click();

    await page.locator("#vault-recovery-code").fill("invalid-recovery-code-xxxx");
    await page.getByLabel("新主密码").fill(RECOVERED_MASTER_PASSWORD);
    await page.getByRole("button", { name: "恢复密码库" }).click();

    // The error message depends on the browser's WebCrypto implementation.
    // It may be a Chinese message or a native DOMException text (e.g.
    // "OperationError").  Just check that an error banner appeared.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  });

  test("L-07: New master password shorter than 12 chars shows error", async ({
    page,
  }) => {
    await createVault(page);

    // Generate recovery code so a packet exists
    await navigateTo(page, "恢复备份");
    await page.getByRole("button", { name: "生成恢复码" }).click();
    const codeEl = page.locator("code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const recoveryCode = await codeEl.innerText();

    // Lock vault
    await lockVault(page);

    await page
      .getByRole("button", { name: /使用恢复码/ })
      .click();

    await page.locator("#vault-recovery-code").fill(recoveryCode);
    // Enter a short password (less than 12 chars)
    await page.getByLabel("新主密码").fill("short");

    // The input has minLength={12} which triggers native browser constraint
    // validation before the React onSubmit handler fires.  The vault-provider
    // "password-too-short" error is therefore never reached; instead the
    // browser shows its native validation tooltip.
    await page.getByRole("button", { name: "恢复密码库" }).click();

    // Verify the browser flagged the field as invalid
    const validationMsg = await page
      .locator("#vault-recovery-password")
      .evaluate((el) => (el as HTMLInputElement).validationMessage);
    expect(validationMsg.length).toBeGreaterThan(0);
  });

  test("L-08: No recovery packet shows error", async ({
    page,
  }) => {
    await createVault(page);

    // Lock vault without generating a recovery code
    await lockVault(page);

    // Toggle the recovery entry form
    await page
      .getByRole("button", { name: /使用恢复码/ })
      .click();

    // Fill form fields so the vault-provider can proceed past "no-code" check
    await page.locator("#vault-recovery-code").fill("some-recovery-code");
    await page.getByLabel("新主密码").fill("123456789012");
    await page.getByRole("button", { name: "恢复密码库" }).click();

    // Should show no-packet error in the page error banner
    await expect(
      page.getByText(/未找到.*恢复|未找到恢复包|未找到离线恢复记录/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("L-09: Regenerate recovery code", async ({ page }) => {
    await createVault(page);

    // First generation
    await navigateTo(page, "恢复备份");
    await page.getByRole("button", { name: "生成恢复码" }).click();

    const codeEl = page.locator("code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const firstCode = await codeEl.innerText();

    // Clear the recovery packet from localStorage and reload to reset
    // vault-provider state so the "生成恢复码" button becomes available again.
    await page.evaluate(() => {
      localStorage.removeItem("zero-vault.local.recovery-packet.v1");
    });
    await page.goto("/");
    await expect(page.locator("#master-password")).toBeVisible({ timeout: 15_000 });
    await page.locator("#master-password").fill(MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 30_000 });

    // Generate again
    await navigateTo(page, "恢复备份");
    await page.getByRole("button", { name: "生成恢复码" }).click();
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const secondCode = await codeEl.innerText();

    // The codes should be different (both non-empty)
    expect(firstCode.length).toBeGreaterThan(0);
    expect(secondCode.length).toBeGreaterThan(0);
    expect(secondCode).not.toBe(firstCode);
  });
});
