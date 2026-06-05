import { test, expect, type Page } from "@playwright/test";

const MASTER_PASSWORD = "TestPassword123!Secure";
const UPDATED_MASTER_PASSWORD = "UpdatedPassword123!Secure";
const RECOVERED_MASTER_PASSWORD = "RecoveredPassword123!Secure";

/**
 * Navigate to the app, fill the master password, and create a new vault.
 * Waits for the unlocked UI (stats-grid) to appear.
 */
async function createVault(page: Page) {
  await page.goto("/");
  const passwordInput = page.locator("#master-password");
  await expect(passwordInput).toBeVisible({ timeout: 15_000 });
  await passwordInput.fill(MASTER_PASSWORD);
  const createButton = page.getByRole("button", { name: /创建密码库/ });
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(page.locator(".stats-grid")).toBeVisible({ timeout: 30_000 });
}

/**
 * Open the create drawer, fill in the credential fields, save, and wait for
 * the new credential to appear in the list.
 */
async function addCredential(
  page: Page,
  opts: { title: string; origin: string; username: string; password: string },
) {
  await page.getByRole("button", { name: "新增凭据" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("标题").fill(opts.title);
  await drawer.getByLabel("网站地址").fill(opts.origin);
  await drawer.getByLabel("用户名").fill(opts.username);
  await drawer.getByLabel("密码", { exact: true }).fill(opts.password);
  await drawer.getByRole("button", { name: "保存凭据" }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });
  await expect(
    page.locator('.app-main [role="button"]').filter({ hasText: opts.title }),
  ).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Vault creation and unlock
// ---------------------------------------------------------------------------

test.describe("Vault creation and unlock flow", () => {
  test("creates a new vault and accesses the main UI", async ({ page }) => {
    await page.goto("/");

    const passwordInput = page.locator("#master-password");
    await expect(passwordInput).toBeVisible({ timeout: 15_000 });
    await passwordInput.fill(MASTER_PASSWORD);

    const createButton = page.getByRole("button", { name: /创建密码库/ });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect(page.locator(".stats-grid")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole("button", { name: "凭据", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "导入", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "同步与设备" })).toBeVisible();

    await expect(page.locator(".app-main")).toBeVisible();
    await expect(page.locator("#master-password")).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// Credential CRUD flow
// ---------------------------------------------------------------------------

test.describe("Credential CRUD flow", () => {
  test("adds, edits, and deletes a credential", async ({ page }) => {
    await createVault(page);

    // -- Add --
    await addCredential(page, {
      title: "E2E Test Site",
      origin: "https://e2e.example.com",
      username: "e2euser@example.com",
      password: "StrongP@ssw0rd!23",
    });

    // Verify the credential appears in the list
    const row = page
      .locator('.app-main [role="button"]')
      .filter({ hasText: "E2E Test Site" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("e2euser@example.com");

    // -- Edit --
    await row.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    await expect(drawer).toContainText("编辑凭据");

    const usernameField = drawer.getByLabel("用户名");
    await usernameField.clear();
    await usernameField.fill("updated@example.com");
    await drawer.getByRole("button", { name: "保存修改" }).click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    // Verify the updated username
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "E2E Test Site" }),
    ).toContainText("updated@example.com");

    // -- Delete --
    const updatedRow = page
      .locator('.app-main [role="button"]')
      .filter({ hasText: "E2E Test Site" });
    await updatedRow.getByRole("button", { name: "删除凭据" }).click();
    await updatedRow.getByRole("button", { name: "确认" }).click();

    // Verify the credential is removed
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "E2E Test Site" }),
    ).toBeHidden({ timeout: 15_000 });
  });

  test("batch deletes selected credentials", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      title: "Batch Delete One",
      origin: "https://batch-one.example.com",
      username: "one@example.com",
      password: "BatchDeleteStrong!1",
    });
    await addCredential(page, {
      title: "Batch Delete Two",
      origin: "https://batch-two.example.com",
      username: "two@example.com",
      password: "BatchDeleteStrong!2",
    });

    await page.getByLabel("选择 Batch Delete One").check();
    await page.getByLabel("选择 Batch Delete Two").check();
    await expect(page.getByText("已选择 2 项")).toBeVisible();

    await page.getByRole("button", { name: "批量删除" }).click();

    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Batch Delete One" }),
    ).toBeHidden({ timeout: 15_000 });
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Batch Delete Two" }),
    ).toBeHidden({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Sync feedback
// ---------------------------------------------------------------------------

test.describe("Sync feedback", () => {
  test("shows a visible login-required message when sync is clicked before account login", async ({ page }) => {
    await createVault(page);

    await page.getByRole("button", { name: "同步", exact: true }).click();

    await expect(page.getByText("同步需要登录").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("alert").filter({
        hasText: "请先在左侧账户区注册或登录后再同步。",
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "同步与设备" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "请先在左侧账户区注册或登录后再同步。",
      }),
    ).toBeVisible();
  });

  test("shows a visible API error when account login cannot reach the backend", async ({ page }) => {
    await createVault(page);

    await page.getByRole("button", { name: "账户" }).click();
    await page.getByPlaceholder("you@example.com").fill("missing-api@example.com");
    await page.getByPlaceholder("账户密码").fill("MissingApiPassword123!");
    await page.getByRole("button", { name: "登录", exact: true }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: /request_failed_404|network_error/u }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// CSV import flow
// ---------------------------------------------------------------------------

test.describe("CSV import flow", () => {
  test("imports only valid HTTPS rows from a browser CSV", async ({ page }) => {
    await createVault(page);

    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.getByLabel("Chrome").check();
    await page.getByRole("button", { name: /下一步/ }).click();

    const csv = [
      "name,url,username,password",
      "Imported HTTPS,https://import-valid.example.com,valid@example.com,ValidImportStrong!123",
      "Imported Insecure,http://import-insecure.example.com,insecure@example.com,InsecureImportStrong!123",
    ].join("\n");
    await page.getByLabel("选择导入文件").setInputFiles({
      name: "passwords.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText("有效 1")).toBeVisible();
    await expect(page.getByText("警告 1")).toBeVisible();
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByLabel("我理解 CSV 文件包含明文密码，导入后将删除原文件").check();
    await page.getByRole("button", { name: /确认导入/ }).click();

    await expect(page.getByText("已导入 1 条，已拒绝 1 条。请在导入后删除明文 CSV 文件。")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "凭据", exact: true }).click();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Imported HTTPS" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "import-insecure.example.com" }),
    ).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// Credential search and filter
// ---------------------------------------------------------------------------

test.describe("Credential search and filter", () => {
  test("filters credentials by search query", async ({ page }) => {
    await createVault(page);

    // Add three credentials
    await addCredential(page, {
      title: "GitHub",
      origin: "https://github.com",
      username: "ghuser",
      password: "GhStr0ng!Pass#1",
    });
    await addCredential(page, {
      title: "GitLab",
      origin: "https://gitlab.com",
      username: "gluser",
      password: "GlStr0ng!Pass#2",
    });
    await addCredential(page, {
      title: "Google Mail",
      origin: "https://mail.google.com",
      username: "gmuser",
      password: "GmStr0ng!Pass#3",
    });

    // All three should be visible
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitHub" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitLab" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Google Mail" }),
    ).toBeVisible();

    // Search for "Git" — should match GitHub and GitLab, not Google Mail
    const searchInput = page.getByPlaceholder("搜索凭据...");
    await searchInput.fill("Git");

    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitHub" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitLab" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Google Mail" }),
    ).toBeHidden();

    // Search for "Google" — should match only Google Mail
    await searchInput.clear();
    await searchInput.fill("Google");

    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Google Mail" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitHub" }),
    ).toBeHidden();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitLab" }),
    ).toBeHidden();

    // Clear search — all three visible again
    await searchInput.clear();

    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitHub" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "GitLab" }),
    ).toBeVisible();
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Google Mail" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Password generator
// ---------------------------------------------------------------------------

test.describe("Password generator", () => {
  test("generates a password in the credential drawer", async ({ page }) => {
    await createVault(page);

    // Open the create drawer
    await page.getByRole("button", { name: "新增凭据" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    // The password field should be empty initially
    const passwordField = drawer.getByLabel("密码", { exact: true });
    await expect(passwordField).toHaveValue("");

    // Click the generate button
    await drawer.getByRole("button", { name: "生成密码" }).click();

    // The password field should now contain a generated password
    const generatedValue = await passwordField.inputValue();
    expect(generatedValue.length).toBeGreaterThanOrEqual(20);
    expect(generatedValue).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Settings flow
// ---------------------------------------------------------------------------

test.describe("Settings flow", () => {
  test("changes the master password and keeps subsequent edits encrypted with the new key", async ({ page }) => {
    await createVault(page);
    await addCredential(page, {
      title: "Before Password Change",
      origin: "https://before-change.example.com",
      username: "before@example.com",
      password: "BeforeChangeStrong!123",
    });

    await page.getByRole("button", { name: "设置" }).click();
    await page.getByLabel("当前密码").fill(MASTER_PASSWORD);
    await page.getByLabel("新密码", { exact: true }).fill(UPDATED_MASTER_PASSWORD);
    await page.getByLabel("确认新密码").fill(UPDATED_MASTER_PASSWORD);
    await page.getByRole("button", { name: "修改密码" }).click();
    await expect(page.getByText("密码修改成功")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "凭据", exact: true }).click();
    await addCredential(page, {
      title: "After Password Change",
      origin: "https://after-change.example.com",
      username: "after@example.com",
      password: "AfterChangeStrong!123",
    });

    await page.getByRole("button", { name: "锁定密码库" }).click();
    await expect(page.locator("#master-password")).toBeVisible({ timeout: 15_000 });

    await page.locator("#master-password").fill(MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.getByText("主密码不正确，或本地密码库已损坏。")).toBeVisible({ timeout: 15_000 });

    await page.locator("#master-password").fill(UPDATED_MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.locator(".stats-grid")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.app-main [role="button"]').filter({ hasText: "Before Password Change" })).toBeVisible();
    await expect(page.locator('.app-main [role="button"]').filter({ hasText: "After Password Change" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Recovery flow
// ---------------------------------------------------------------------------

test.describe("Recovery flow", () => {
  test("recovers an existing local vault with a recovery code and re-encrypts it with a new master password", async ({ page }) => {
    await createVault(page);
    await addCredential(page, {
      title: "Recoverable Site",
      origin: "https://recover.example.com",
      username: "recover@example.com",
      password: "RecoverStrong!123",
    });

    await page.getByRole("button", { name: "恢复码" }).click();

    // RecoverySetup wizard: step 0 (generate) -> step 1 (save) -> step 2 (confirm)
    await page.getByRole("button", { name: "生成恢复码" }).click();

    // Wait for the <code> element to appear (step 1 auto-advances when recoveryCode is set)
    const codeEl = page.locator(".app-main code");
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const recoveryCode = (await codeEl.textContent())?.trim();
    expect(recoveryCode).toBeTruthy();

    // Advance to step 2 (confirm)
    await page.getByRole("button", { name: "下一步" }).click();

    // Enter last 8 chars of recovery code for verification
    await page.locator("#recovery-verify").fill(recoveryCode!.slice(-8));

    // Confirm save
    await page.getByRole("button", { name: "确认保存" }).click();

    await page.getByRole("button", { name: "锁定密码库" }).click();
    await expect(page.locator("#master-password")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "使用恢复码恢复密码库" }).click();
    await page.getByLabel("恢复码").fill(recoveryCode!);
    await page.getByLabel("新主密码").fill(RECOVERED_MASTER_PASSWORD);
    await page.getByRole("button", { name: "恢复密码库", exact: true }).click();

    await expect(page.locator(".stats-grid")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("密码库已恢复，包含 1 条凭据。").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Recoverable Site" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "锁定密码库" }).click();
    await expect(page.locator("#master-password")).toBeVisible({ timeout: 15_000 });

    await page.locator("#master-password").fill(MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.getByText("主密码不正确，或本地密码库已损坏。")).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#master-password").fill(RECOVERED_MASTER_PASSWORD);
    await page.getByRole("button", { name: /解锁密码库/ }).click();
    await expect(page.locator(".stats-grid")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('.app-main [role="button"]').filter({ hasText: "Recoverable Site" }),
    ).toBeVisible();
  });
});
