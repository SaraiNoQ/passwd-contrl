import { test, expect, type Page } from "@playwright/test";
import { MASTER_PASSWORD, CREDENTIALS } from "./helpers/constants";
import { createVault, lockVault, unlockVault, navigateTo } from "./helpers/vault";
import {
  addCredential,
  deleteCredential,
  openCredentialForEdit,
  type CredentialOpts,
} from "./helpers/credentials";

// ---------------------------------------------------------------------------
// Module A — Vault lifecycle
// ---------------------------------------------------------------------------

test.describe("Module A — Vault lifecycle", () => {
  test("A-02: empty master password disables submit or shows error", async ({
    page,
  }) => {
    await page.goto("/");
    const passwordInput = page.locator("#master-password");
    await expect(passwordInput).toBeVisible({ timeout: 15_000 });

    // Do NOT fill anything — try to submit
    const createButton = page.getByRole("button", { name: /开始生成|创建密码库/ });
    // The input has minLength={12} and the form uses native validation.
    // The button should either be disabled or the form should not submit
    // (no stats-grid appearing).
    await createButton.click();

    // Should still be on the locked screen — no stats-grid
    await expect(page.locator(".app-main")).toHaveCount(0);
    await expect(passwordInput).toBeVisible();
  });

  test("A-03: unlock with wrong password shows error", async ({ page }) => {
    // First create a vault
    await createVault(page);
    await lockVault(page);

    // Try wrong password
    await page.locator("#master-password").fill("WrongPassword123!X");
    await page.getByRole("button", { name: /解锁密码库/ }).click();

    await expect(
      page.getByText("主密码不正确，或本地密码库已损坏。"),
    ).toBeVisible({ timeout: 15_000 });

    // Should still be on locked screen
    await expect(page.locator("#master-password")).toBeVisible();
  });

  test("A-04: lock vault clears data and resets search/filters", async ({
    page,
  }) => {
    await createVault(page);

    // Add a credential so the list is not empty
    await addCredential(page, {
      title: "Lock Test Site",
      origin: "https://lock-test.example.com",
      username: "lockuser@example.com",
      password: "LockTestStr0ng!1",
    });

    // Type a search query
    const searchInput = page.getByLabel("搜索凭据");
    await searchInput.fill("some query");

    // Lock
    await lockVault(page);

    // Unlock again
    await unlockVault(page);

    // Search should be cleared
    await expect(page.getByLabel("搜索凭据")).toHaveValue("");

    // The credential should still be visible
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Lock Test Site" }),
    ).toBeVisible();
  });

  test("A-05: auto-lock after 1 minute of inactivity", async ({ page }) => {
    test.skip(
      true,
      "Auto-lock timer test takes 60+s and requires real timer; skip in CI.",
    );

    await createVault(page);

    // Navigate to settings and set auto-lock to 1 minute (60s)
    await navigateTo(page, "应用设置");
    await page.getByLabel("自动锁定时间").selectOption("60");

    // Go back to credentials and wait
    await navigateTo(page, "密码列表");

    // Wait for auto-lock to trigger (60s + buffer)
    await expect(page.locator("#master-password")).toBeVisible({
      timeout: 90_000,
    });
  });

  test("A-06: auto-lock timer resets on user activity", async ({ page }) => {
    test.skip(
      true,
      "Auto-lock timer reset test requires real timers; skip in CI.",
    );

    await createVault(page);

    // Navigate to settings and set auto-lock to 1 minute (60s)
    await navigateTo(page, "应用设置");
    await page.getByLabel("自动锁定时间").selectOption("60");

    // Go back to credentials
    await navigateTo(page, "密码列表");

    // Perform activity at ~30s to reset the timer
    await page.waitForTimeout(30_000);
    await page.mouse.click(400, 400);
    await page.keyboard.press("a");
    await page.keyboard.press("Backspace");

    // Wait another 40s — if timer was reset, vault should still be unlocked
    await page.waitForTimeout(40_000);
    await expect(page.locator(".app-main")).toBeVisible();

    // Wait another 30s — now it should lock (total ~100s from first activity,
    // ~70s from reset)
    await expect(page.locator("#master-password")).toBeVisible({
      timeout: 40_000,
    });
  });

  test("A-07: route guard — locked redirects /vault to /", async ({
    page,
  }) => {
    // Navigate to /vault while locked — should redirect to /
    await page.goto("/vault");
    await expect(page.locator("#master-password")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL("/");

    // Create vault — should redirect to /vault
    await page.locator("#master-password").fill(MASTER_PASSWORD);
    await page.getByRole("button", { name: /开始生成|创建密码库/ }).click();
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/vault/u);

    // Lock — should redirect back to /
    await lockVault(page);
    await expect(page).toHaveURL("/", { timeout: 15_000 });

    // Navigate to /vault while locked again — should redirect to /
    await page.goto("/vault");
    await expect(page).toHaveURL("/", { timeout: 15_000 });
    await expect(page.locator("#master-password")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Module B — Credential CRUD
// ---------------------------------------------------------------------------

test.describe("Module B — Credential CRUD", () => {
  test("B-02: add secure_note type credential", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      ...CREDENTIALS.secureNote,
      type: "secure_note",
    });

    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: CREDENTIALS.secureNote.title }),
    ).toBeVisible();
  });

  test("B-03: add credit_card type credential", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      ...CREDENTIALS.creditCard,
      type: "credit_card",
    });

    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: CREDENTIALS.creditCard.title }),
    ).toBeVisible();
  });

  test("B-06: delete credential from within the drawer", async ({ page }) => {
    await createVault(page);

    await addCredential(page, {
      title: "Drawer Delete Test",
      origin: "https://drawer-delete.example.com",
      username: "drawerdel@example.com",
      password: "DrawerDelStr0ng!1",
    });

    // Open the credential in edit drawer
    const drawer = await openCredentialForEdit(page, "Drawer Delete Test");

    // Click the delete button in the drawer footer
    await drawer.getByRole("button", { name: "删除" }).click();

    // The credential should be removed from the list
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Drawer Delete Test" }),
    ).toBeHidden({ timeout: 15_000 });
  });

  test("B-07: login form shows HTTP origin warning", async ({ page }) => {
    await createVault(page);

    // Open create drawer
    await page.getByRole("button", { name: "新增凭据" }).click();
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer).toBeVisible();

    // Fill an HTTP origin
    await drawer.getByLabel("网站地址").fill("http://insecure.example.com");

    // Warning should appear (Input error + originHint both contain this text; use .first())
    await expect(
      drawer.getByText("自动填充仅支持 HTTPS 站点").first(),
    ).toBeVisible();
  });

  test("B-08: password visibility toggle in drawer", async ({ page }) => {
    await createVault(page);

    // Open create drawer
    await page.getByRole("button", { name: "新增凭据" }).click();
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer).toBeVisible();

    const passwordField = drawer.locator("#credential-password");

    // Fill a password
    await passwordField.fill("MySecretPass123!");

    // Password should be hidden by default (type=password)
    await expect(passwordField).toHaveAttribute("type", "password");

    // Click the visibility toggle
    await drawer.getByLabel("显示密码").click();

    // Password should now be visible (type=text)
    await expect(passwordField).toHaveAttribute("type", "text");
    await expect(passwordField).toHaveValue("MySecretPass123!");

    // Toggle back to hidden
    await drawer.getByLabel("隐藏密码").click();
    await expect(passwordField).toHaveAttribute("type", "password");
  });

  test("B-09: copy username/password shows Toast notification", async ({
    page,
  }) => {
    await createVault(page);

    await addCredential(page, {
      title: "Copy Toast Test",
      origin: "https://copy-toast.example.com",
      username: "copyuser@example.com",
      password: "CopyToastStr0ng!1",
    });

    // Click copy username button — use article so action buttons are descendants
    const row = page
      .locator('article')
      .filter({ hasText: "Copy Toast Test" });
    await row.getByLabel(/复制.*用户名/u).click();

    // Toast should appear (or the copy button's aria-label changes to "已复制...")
    await expect(
      page.getByText("已复制到设备剪贴板").or(row.getByLabel(/已复制.*用户名/u)),
    ).toBeVisible({ timeout: 5_000 });

    // Wait for toast/copy feedback to disappear
    await expect(
      page.getByText("已复制到设备剪贴板").or(row.getByLabel(/已复制.*用户名/u)),
    ).toBeHidden({ timeout: 10_000 });

    // Click copy password button
    await row.getByLabel(/复制.*密码/u).click();

    // Toast should appear again (or the copy button's aria-label changes)
    await expect(
      page.getByText("已复制到设备剪贴板").or(row.getByLabel(/已复制.*密码/u)),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("B-10: drawer close via cancel button and Escape key", async ({
    page,
  }) => {
    await createVault(page);

    // Open create drawer
    await page.getByRole("button", { name: "新增凭据" }).click();
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer).toBeVisible();

    // Close via cancel button
    await drawer.getByRole("button", { name: "取消" }).click();
    await expect(drawer).toBeHidden({ timeout: 5_000 });

    // Reopen
    await page.getByRole("button", { name: "新增凭据" }).click();
    await expect(drawer).toBeVisible();

    // Close via Escape key
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 5_000 });
  });

  test("B-11: password strength indicator in credential list", async ({
    page,
  }) => {
    await createVault(page);

    // Add a credential with a strong password
    await addCredential(page, {
      title: "Strong Password Site",
      origin: "https://strong-pw.example.com",
      username: "strong@example.com",
      password: "Str0ng!P@ssw0rd#2024Xy",
    });

    // The credential list should show a strength indicator
    const row = page
      .locator('button[aria-label]')
      .filter({ hasText: "Strong Password Site" });
    // Look for strength label "强" near the row
    await expect(
      row.locator("..").getByLabel(/密码强度/u),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Module C — Batch operations
// ---------------------------------------------------------------------------

test.describe("Module C — Batch operations", () => {
  async function setupBatchCredentials(page: Page) {
    await addCredential(page, {
      title: "Batch One",
      origin: "https://batch-one.example.com",
      username: "batch1@example.com",
      password: "BatchOneStr0ng!1",
    });
    await addCredential(page, {
      title: "Batch Two",
      origin: "https://batch-two.example.com",
      username: "batch2@example.com",
      password: "BatchTwoStr0ng!2",
    });
    await addCredential(page, {
      title: "Batch Three",
      origin: "https://batch-three.example.com",
      username: "batch3@example.com",
      password: "BatchThreeStr0ng!3",
    });
  }

  test("C-02: select all / deselect all", async ({ page }) => {
    await createVault(page);
    await setupBatchCredentials(page);

    // Click "全选" checkbox
    await page.getByLabel("全选").check();
    await expect(page.getByText("已选择 3 项")).toBeVisible();

    // Deselect all
    await page.getByLabel("全选").uncheck();
    await expect(page.getByText("已选择")).toHaveCount(0);
  });

  test("C-03: batch update password full flow", async ({ page }) => {
    await createVault(page);
    await setupBatchCredentials(page);

    // Select two credentials
    await page.getByLabel("选择 Batch One").check();
    await page.getByLabel("选择 Batch Two").check();
    await expect(page.getByText("已选择 2 项")).toBeVisible();

    // Click batch update password
    await page.getByRole("button", { name: "批量更新密码" }).click();

    // The batch update drawer should open
    const batchDrawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(batchDrawer).toBeVisible();
    await expect(batchDrawer).toContainText("批量更新密码");

    // Use the generated password via the "使用此密码" button in the embedded generator
    await batchDrawer.getByRole("button", { name: "使用此密码" }).click();

    // Confirm the update
    await batchDrawer.getByRole("button", { name: "确认更新" }).click();

    // Wait for drawer to close and update to complete
    await expect(batchDrawer).toBeHidden({ timeout: 15_000 });

    // Both credentials should still be in the list
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Batch One" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Batch Two" }),
    ).toBeVisible();
  });

  test("C-04: batch update — regenerate", async ({ page }) => {
    await createVault(page);
    await setupBatchCredentials(page);

    // Select a credential
    await page.getByLabel("选择 Batch One").check();
    await page.getByRole("button", { name: "批量更新密码" }).click();

    const batchDrawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(batchDrawer).toBeVisible();

    // Use the generated password
    await batchDrawer.getByRole("button", { name: "使用此密码" }).click();

    // The confirm view should show. Click "重新生成" to go back to generator
    await batchDrawer.getByRole("button", { name: "重新生成" }).click();

    // Use again
    await batchDrawer.getByRole("button", { name: "使用此密码" }).click();

    // Now confirm
    await batchDrawer.getByRole("button", { name: "确认更新" }).click();
    await expect(batchDrawer).toBeHidden({ timeout: 15_000 });
  });

  test("C-05: batch update — cancel", async ({ page }) => {
    await createVault(page);
    await setupBatchCredentials(page);

    // Select a credential
    await page.getByLabel("选择 Batch One").check();
    await page.getByRole("button", { name: "批量更新密码" }).click();

    const batchDrawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(batchDrawer).toBeVisible();

    // Cancel — the generator view has no "取消" button; use the Drawer's close button
    await batchDrawer.getByLabel("关闭").click();
    await expect(batchDrawer).toBeHidden({ timeout: 5_000 });

    // The original password should be unchanged — credential still in list
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Batch One" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Module D — Search and filter
// ---------------------------------------------------------------------------

test.describe("Module D — Search and filter", () => {
  async function setupSearchCredentials(page: Page) {
    await addCredential(page, {
      title: "Alpha Corp",
      origin: "https://alpha.example.com",
      username: "alphauser",
      password: "AlphaStr0ng!Pass1",
    });
    await addCredential(page, {
      title: "Beta Service",
      origin: "https://beta.example.com",
      username: "betauser",
      password: "AlphaStr0ng!Pass1", // duplicate password
    });
    await addCredential(page, {
      title: "Gamma Notes",
      origin: "https://gamma.example.com",
      username: "gammauser",
      password: "weak", // weak password
    });
    await addCredential(page, {
      type: "secure_note",
      title: "WiFi Password",
      noteBody: "Network: HomeNet, Password: AlphaStr0ng!Pass1",
    });
    await addCredential(page, {
      type: "credit_card",
      title: "My Visa Card",
      cardholderName: "Gamma User",
      cardNumber: "4111111111111111",
      expirationMonth: "12",
      expirationYear: "2030",
      cvv: "123",
      brand: "Visa",
    });
  }

  test("D-02: search matches across title, origin, username, noteBody, cardholderName", async ({
    page,
  }) => {
    await createVault(page);
    await setupSearchCredentials(page);

    const searchInput = page.getByLabel("搜索凭据");

    // Search by title
    await searchInput.fill("Alpha");
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Alpha Corp" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Beta Service" }),
    ).toBeHidden();

    // Search by origin
    await searchInput.fill("beta.example");
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Beta Service" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Alpha Corp" }),
    ).toBeHidden();

    // Search by username
    await searchInput.fill("gammauser");
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Gamma Notes" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Alpha Corp" }),
    ).toBeHidden();

    // Search by noteBody (secure note)
    await searchInput.fill("HomeNet");
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "WiFi Password" }),
    ).toBeVisible();

    // Search by cardholderName (credit card)
    await searchInput.fill("Gamma User");
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "My Visa Card" }),
    ).toBeVisible();

    // Clear search — all visible
    await searchInput.clear();
    await expect(
      page.getByRole('button', { name: /编辑 Alpha Corp/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /编辑 WiFi Password/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /编辑 My Visa Card/ }),
    ).toBeVisible();
  });

  test("D-03: weak password filter", async ({ page }) => {
    await createVault(page);
    await setupSearchCredentials(page);

    // Scope to the filter bar to avoid matching sidebar "全部密码"
    const filterBar = page.locator('[aria-label="密码库筛选和排序"]');

    // Click the "弱密码" filter tab
    await filterBar.getByRole("button", { name: /弱密码/ }).click();

    // Only "Gamma Notes" (password "weak") should be visible
    await expect(
      page.locator('article').filter({ hasText: "Gamma Notes" }),
    ).toBeVisible();
    await expect(
      page.locator('article').filter({ hasText: "Alpha Corp" }),
    ).toBeHidden();

    // Reset filter
    await filterBar.getByRole("button", { name: /全部/ }).click();
    await expect(
      page.locator('article').filter({ hasText: "Alpha Corp" }),
    ).toBeVisible();
  });

  test("D-04: duplicate password filter", async ({ page }) => {
    await createVault(page);
    await setupSearchCredentials(page);

    // Click the "复用密码" filter tab
    await page.getByRole("button", { name: /复用密码/u }).click();

    // "Alpha Corp" and "Beta Service" share the same password
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Alpha Corp" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Beta Service" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Gamma Notes" }),
    ).toBeHidden();
  });

  test("D-07: sort by name (asc/desc), updated time, created time", async ({
    page,
  }) => {
    await createVault(page);

    // Add credentials in reverse alphabetical order with a delay to ensure distinct timestamps
    await addCredential(page, {
      title: "Zulu Site",
      origin: "https://zulu.example.com",
      username: "zulu@example.com",
      password: "ZuluStr0ng!Pass1",
    });
    // Wait 2 seconds so createdAt timestamps differ by >1s
    await page.waitForTimeout(2_000);
    await addCredential(page, {
      title: "Alpha Site",
      origin: "https://alpha.example.com",
      username: "alpha@example.com",
      password: "AlphaStr0ng!Pass1",
    });

    // Use article elements to match credential cards only (not sort/filter buttons)
    const rows = page.locator('article');

    // Default sort is by "最近更新" desc — most recent first
    // So "Alpha Site" (added last) should come first
    const firstRowText = await rows.first().textContent();
    expect(firstRowText).toContain("Alpha Site");

    // Switch to sort by name — direction resets to asc
    await page.locator('[aria-label="密码库筛选和排序"]').getByRole("button", { name: "名称" }).click();

    // After sorting by name ascending, "Alpha Site" should come first
    const firstAfterNameSort = await rows.first().textContent();
    expect(firstAfterNameSort).toContain("Alpha Site");

    // Toggle direction to descending
    await page.getByLabel("切换为降序").click();
    const firstAfterDesc = await rows.first().textContent();
    expect(firstAfterDesc).toContain("Zulu Site");

    // Switch to "创建时间" sort — direction resets to asc
    await page.locator('[aria-label="密码库筛选和排序"]').getByRole("button", { name: "创建时间" }).click();
    // Ascending: oldest first → "Zulu Site" (created first) comes first
    const firstAfterCreated = await rows.first().textContent();
    expect(firstAfterCreated).toContain("Zulu Site");

    // Toggle to descending — most recently created first
    await page.getByLabel("切换为降序").click();
    const firstAfterCreatedDesc = await rows.first().textContent();
    expect(firstAfterCreatedDesc).toContain("Alpha Site");
  });

  test("D-08: search + filter combination", async ({ page }) => {
    await createVault(page);
    await setupSearchCredentials(page);

    // Scope to the filter bar to avoid matching sidebar "全部密码"
    const filterBar = page.locator('[aria-label="密码库筛选和排序"]');

    // Apply weak password filter
    await filterBar.getByRole("button", { name: /弱密码/ }).click();

    // Only "Gamma Notes" is weak
    await expect(
      page.locator('article').filter({ hasText: "Gamma Notes" }),
    ).toBeVisible();

    // Now also search for something that doesn't match "Gamma Notes"
    const searchInput = page.getByLabel("搜索凭据");
    await searchInput.fill("Alpha");

    // No results should be visible (Alpha Corp is not weak)
    await expect(
      page.locator('article').filter({ hasText: "Alpha Corp" }),
    ).toBeHidden();
    await expect(
      page.locator('article').filter({ hasText: "Gamma Notes" }),
    ).toBeHidden();

    // Search for "Gamma" — should match the weak credential
    await searchInput.fill("Gamma");
    await expect(
      page.locator('article').filter({ hasText: "Gamma Notes" }),
    ).toBeVisible();

    // Clear search, reset filter
    await searchInput.clear();
    await filterBar.getByRole("button", { name: /全部/ }).click();

    // All credentials visible again
    await expect(
      page.locator('article').filter({ hasText: "Alpha Corp" }),
    ).toBeVisible();
    await expect(
      page.locator('article').filter({ hasText: "Gamma Notes" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Module E — Folders
// ---------------------------------------------------------------------------

test.describe("Module E — Folders", () => {
  test("E-01: assign folder when creating credential", async ({ page }) => {
    await createVault(page);

    // Open create drawer and fill folder
    await page.getByRole("button", { name: "新增凭据" }).click();
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer).toBeVisible();

    await drawer.getByLabel("标题").fill("Folder Test Site");
    await drawer.getByLabel("网站地址").fill("https://folder-test.example.com");
    await drawer.getByLabel("用户名").fill("folderuser@example.com");
    await drawer.locator("#credential-password").fill("FolderTestStr0ng!1");

    // Fill the folder input
    const folderInput = drawer.locator('input[placeholder="未分类"]');
    await folderInput.fill("Work");

    await drawer.getByRole("button", { name: "保存凭据" }).click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    // The credential should show a folder tag in the list
    const row = page
      .locator('button[aria-label]')
      .filter({ hasText: "Folder Test Site" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Work");
  });

  test("E-02: folder autocomplete suggestions", async ({ page }) => {
    await createVault(page);

    // First create a credential with a folder
    await addCredential(page, {
      title: "Folder Seed",
      origin: "https://folder-seed.example.com",
      username: "seed@example.com",
      password: "FolderSeedStr0ng!1",
      folder: "MyFolder",
    });

    // Open create drawer for a second credential
    await page.getByRole("button", { name: "新增凭据" }).click();
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer).toBeVisible();

    // Type partial folder name into the folder input
    const folderInput = drawer.locator('input[placeholder="未分类"]');
    await folderInput.fill("My");
    await folderInput.focus();

    // Autocomplete suggestion should appear with "MyFolder"
    await expect(drawer.getByText("MyFolder").first()).toBeVisible({
      timeout: 5_000,
    });

    // Close drawer
    await drawer.getByRole("button", { name: "取消" }).click();
  });

  test("E-03: sidebar folder navigation", async ({ page }) => {
    await createVault(page);

    // Add credentials in different folders
    await addCredential(page, {
      title: "Work Site",
      origin: "https://work.example.com",
      username: "work@example.com",
      password: "WorkStr0ng!Pass1",
      folder: "Work",
    });
    await addCredential(page, {
      title: "Personal Site",
      origin: "https://personal.example.com",
      username: "personal@example.com",
      password: "PersonalStr0ng!1",
      folder: "Personal",
    });
    await addCredential(page, {
      title: "No Folder Site",
      origin: "https://nofolder.example.com",
      username: "nofolder@example.com",
      password: "NoFolderStr0ng!1",
    });

    // Expand folder section in sidebar (it should be expanded by default)
    // Click on "Work" folder
    await page.getByRole("button", { name: "Work" }).first().click();

    // Only "Work Site" should be visible
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Work Site" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Personal Site" }),
    ).toBeHidden();

    // Click "全部密码" to show all
    await page.getByRole("button", { name: "全部密码" }).click();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Work Site" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Personal Site" }),
    ).toBeVisible();

    // Click "未分类" to show uncategorized
    await page.getByRole("button", { name: "未分类" }).click();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "No Folder Site" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Work Site" }),
    ).toBeHidden();
  });

  test("E-04: folder breadcrumb navigation", async ({ page }) => {
    await createVault(page);

    // Add a credential with a folder
    await addCredential(page, {
      title: "Breadcrumb Site",
      origin: "https://breadcrumb.example.com",
      username: "breadcrumb@example.com",
      password: "BreadcrumbStr0ng!1",
      folder: "Projects",
    });

    // Navigate to the folder via sidebar
    await page.getByRole("button", { name: "Projects" }).first().click();

    // Breadcrumb should show "密码列表 > Projects" — scope to breadcrumb container
    const breadcrumb = page.locator('.folder-breadcrumb');
    await expect(breadcrumb.getByText("密码列表")).toBeVisible();
    await expect(breadcrumb.getByText("Projects")).toBeVisible();

    // Click breadcrumb link to go back to all
    await page.locator('.folder-breadcrumb-link').click();

    // All credentials should be visible
    await expect(
      page.locator('article').filter({ hasText: "Breadcrumb Site" }),
    ).toBeVisible();
  });

  test("E-05: folder + search combination", async ({ page }) => {
    await createVault(page);

    // Add credentials in the same folder
    await addCredential(page, {
      title: "Search Folder A",
      origin: "https://search-fold-a.example.com",
      username: "sfa@example.com",
      password: "SearchFoldAStr0ng!1",
      folder: "SearchTest",
    });
    await addCredential(page, {
      title: "Search Folder B",
      origin: "https://search-fold-b.example.com",
      username: "sfb@example.com",
      password: "SearchFoldBStr0ng!2",
      folder: "SearchTest",
    });

    // Navigate to the folder
    await page.getByRole("button", { name: "SearchTest" }).first().click();

    // Both should be visible
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Search Folder A" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Search Folder B" }),
    ).toBeVisible();

    // Search within the folder
    const searchInput = page.getByLabel("搜索凭据");
    await searchInput.fill("Folder A");

    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Search Folder A" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Search Folder B" }),
    ).toBeHidden();

    // Clear search — both visible again within folder
    await searchInput.clear();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Search Folder A" }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Search Folder B" }),
    ).toBeVisible();
  });
});
