import { test, expect, type Page } from "@playwright/test";
import { createVault } from "./helpers/vault";
import { addCredential, openCredentialForEdit } from "./helpers/credentials";

// Valid base32 secret (160 bits, 32 chars)
const VALID_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

// ---------------------------------------------------------------------------
// Helper: fill TOTP secret in the drawer's TOTP input
// ---------------------------------------------------------------------------

async function fillTotpSecret(page: Page, secret: string): Promise<void> {
  const drawer = page.locator('[role="dialog"][aria-modal="true"]');
  const totpInput = drawer.getByPlaceholder("otpauth://... 或 base32 密钥");
  await expect(totpInput).toBeVisible();
  await totpInput.clear();
  await totpInput.fill(secret);
}

// ---------------------------------------------------------------------------
// Module O: TOTP
// ---------------------------------------------------------------------------

test.describe("Module O: TOTP", () => {
  test("O-01: Add TOTP secret to login credential", async ({ page }) => {
    await createVault(page);

    // Create a credential first
    await addCredential(page, {
      title: "TOTP Test Login",
      origin: "https://totp.example.com",
      username: "totpuser@example.com",
      password: "TotpStrong!Pass1",
    });

    // Open the credential for editing
    const drawer = await openCredentialForEdit(page, "TOTP Test Login");

    // Fill in a valid TOTP secret
    await fillTotpSecret(page, VALID_TOTP_SECRET);

    // Verify the TOTP beacon shows "信标运行中" after valid secret is entered
    await expect(drawer.getByText("信标运行中")).toBeVisible({ timeout: 10_000 });

    // Save the credential
    await drawer.getByRole("button", { name: "保存修改" }).click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    // Re-open and verify TOTP is still active
    const drawer2 = await openCredentialForEdit(page, "TOTP Test Login");
    await expect(drawer2.getByText("信标运行中")).toBeVisible({ timeout: 5_000 });
    // TotpDisplay should be visible
    await expect(drawer2.locator('[aria-label^="当前动态验证码"]')).toBeVisible();
  });

  test("O-02: TOTP code display shows 6-digit code and countdown", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      title: "TOTP Display Test",
      origin: "https://totp-display.example.com",
      username: "display@example.com",
      password: "DisplayStrong!Pass1",
    });

    const drawer = await openCredentialForEdit(page, "TOTP Display Test");
    await fillTotpSecret(page, VALID_TOTP_SECRET);
    await expect(drawer.getByText("信标运行中")).toBeVisible({ timeout: 10_000 });

    // Verify the TOTP code output shows a formatted 6-digit code (e.g. "123 456")
    const codeOutput = drawer.locator('[aria-label^="当前动态验证码"]');
    await expect(codeOutput).toBeVisible();
    const codeText = await codeOutput.textContent();
    expect(codeText).toMatch(/^\d{3}\s\d{3}$/);

    // Verify countdown timer shows seconds remaining
    const timerValue = drawer.locator("span").filter({ hasText: /秒后换码/ });
    await expect(timerValue).toBeVisible();
  });

  test("O-03: TOTP scanner button exists", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      title: "TOTP Scanner Test",
      origin: "https://totp-scanner.example.com",
      username: "scanner@example.com",
      password: "ScannerStrong!Pass1",
    });

    const drawer = await openCredentialForEdit(page, "TOTP Scanner Test");

    // Verify the scanner section is present with the camera button
    const scanButton = drawer.getByRole("button", { name: "扫描二维码" });
    await expect(scanButton).toBeVisible();

    // Verify the clipboard paste button exists
    const pasteButton = drawer.getByRole("button", { name: "从剪贴板粘贴" });
    await expect(pasteButton).toBeVisible();
  });

  test("O-04: Invalid TOTP secret shows no TOTP code", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      title: "TOTP Invalid Test",
      origin: "https://totp-invalid.example.com",
      username: "invalid@example.com",
      password: "InvalidStrong!Pass1",
    });

    const drawer = await openCredentialForEdit(page, "TOTP Invalid Test");

    // Enter garbage text that is not a valid base32 secret
    await fillTotpSecret(page, "not-a-valid-secret!!");

    // The TOTP state should remain "等待密钥" (not "信标运行中")
    await expect(drawer.getByText("等待密钥")).toBeVisible();

    // No TotpDisplay should appear (it only renders when isValidTotpSecret is true)
    await expect(drawer.locator('[aria-label^="当前动态验证码"]')).toBeHidden();

    // The input field should still be visible (scanner/input mode, not display mode)
    await expect(drawer.getByPlaceholder("otpauth://... 或 base32 密钥")).toBeVisible();
  });
});
