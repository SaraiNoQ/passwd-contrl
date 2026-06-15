import { test, expect } from "@playwright/test";
import { createVault } from "./helpers/vault";
import { CSV_MIXED, GENERIC_JSON } from "./helpers/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared Chrome-format mixed CSV: one HTTPS + one HTTP entry. */
const CSV_MIXED_CHROME = CSV_MIXED;

/** Edge uses the same CSV format as Chrome. */
const CSV_MIXED_EDGE = CSV_MIXED;

/**
 * Firefox CSV uses signon_realm / username / password headers.
 * detectImportFormat treats any CSV with known headers (or just commas) as
 * "csv", so the auto-detect mapping in parsePasswordCsv picks up these
 * non-standard headers by falling back to empty strings for missing fields.
 * We include standard "name" and "url" columns so the auto-detect picks them
 * up, plus the Firefox-specific signon_realm column (which the parser ignores
 * when "url" is present).
 */
const CSV_MIXED_FIREFOX = [
  "signon_realm,url,username,password",
  "https://secure.example.com,https://secure.example.com,user@example.com,SecurePass!123",
  "http://insecure.example.com,http://insecure.example.com,user@example.com,InsecurePass!123",
].join("\n");

/** 1Password CSV uses url / username / password headers. */
const CSV_MIXED_1PASSWORD = [
  "title,url,username,password,notes",
  "1Password HTTPS,https://secure.example.com,user@example.com,SecurePass!123,",
  "1Password HTTP,http://insecure.example.com,user@example.com,InsecurePass!123,",
].join("\n");

/**
 * Bitwarden JSON must include `encrypted: false` for detectImportFormat to
 * route it to the "bitwarden" parser. The shared BITWARDEN_JSON constant
 * omits this field, so we define a fixture that matches a real Bitwarden
 * unencrypted export here.
 */
const BITWARDEN_JSON_FIXTURE = JSON.stringify({
  encrypted: false,
  items: [
    {
      type: 1,
      name: "Bitwarden Import",
      login: {
        uris: [{ match: null, uri: "https://bitwarden.example.com" }],
        username: "bwuser@example.com",
        password: "BwStrong!Pass123",
      },
    },
  ],
});

/**
 * Walk through the full import wizard from source selection to confirmation,
 * then return without clicking "确认导入" (caller decides final action).
 */
async function runImportWizard(
  page: import("@playwright/test").Page,
  opts: {
    sourceName: string;
    file: { name: string; mimeType: string; buffer: Buffer };
  },
) {
  // Step 0: select source
  await page.getByLabel(opts.sourceName).check();
  await page.getByRole("button", { name: "下一步" }).click();

  // Step 1: upload file
  await page.getByLabel("选择导入文件").setInputFiles(opts.file);
}

/** Click through preview, confirm checkbox, and final "确认导入". */
async function confirmImport(page: import("@playwright/test").Page) {
  // Step 2 -> 3 (preview -> confirm)
  await page.getByRole("button", { name: "下一步" }).click();

  // Step 3: check confirmation checkbox and click import
  await page
    .getByLabel(
      "我理解导入文件包含明文密码，导入后将删除原文件",
    )
    .check();
  await page.getByRole("button", { name: "确认导入" }).click();
}

// ---------------------------------------------------------------------------
// F-01: Wizard step indicator
// ---------------------------------------------------------------------------

test.describe("Import wizard step indicator", () => {
  test("F-01: shows all 5 steps in the indicator", async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    const stepList = page.getByLabel("导入进度");
    await expect(stepList).toBeVisible();

    const steps = ["选择来源", "选择文件", "检查内容", "确认导入", "导入结果"];
    for (const label of steps) {
      await expect(stepList.getByText(label, { exact: true })).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// F-02: Chrome CSV import (mixed HTTPS + HTTP)
// ---------------------------------------------------------------------------

test.describe("Chrome CSV import", () => {
  test("F-02: imports valid HTTPS entry and rejects HTTP entry", async ({
    page,
  }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await runImportWizard(page, {
      sourceName: "Chrome",
      file: { name: "passwords.csv", mimeType: "text/csv", buffer: Buffer.from(CSV_MIXED_CHROME) },
    });

    // Step 2: verify preview stats
    await expect(page.getByText("有效 1")).toBeVisible();
    await expect(page.getByText("警告 1")).toBeVisible();

    await confirmImport(page);

    // Step 4: verify result
    await expect(page.getByText("已导入 1 条，已拒绝 1 条")).toBeVisible({
      timeout: 15_000,
    });

    // Verify HTTPS entry visible in vault
    await page.getByRole("button", { name: "密码列表" }).click();
    await expect(
      page.getByRole('button', { name: /编辑 HTTPS Site/ }),
    ).toBeVisible();

    // Verify HTTP entry rejected (not in vault)
    await expect(
      page.getByRole('button', { name: /编辑 insecure.example.com/ }),
    ).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// F-03: Edge CSV import
// ---------------------------------------------------------------------------

test.describe("Edge CSV import", () => {
  test("F-03: imports valid HTTPS entry and rejects HTTP entry", async ({
    page,
  }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await runImportWizard(page, {
      sourceName: "Edge",
      file: { name: "passwords.csv", mimeType: "text/csv", buffer: Buffer.from(CSV_MIXED_EDGE) },
    });

    await expect(page.getByText("有效 1")).toBeVisible();
    await expect(page.getByText("警告 1")).toBeVisible();

    await confirmImport(page);

    await expect(page.getByText("已导入 1 条，已拒绝 1 条")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "密码列表" }).click();
    await expect(
      page.getByRole('button', { name: /编辑 HTTPS Site/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /编辑 insecure.example.com/ }),
    ).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// F-04: Firefox CSV import
// ---------------------------------------------------------------------------

test.describe("Firefox CSV import", () => {
  test("F-04: imports valid HTTPS entry and rejects HTTP entry", async ({
    page,
  }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await runImportWizard(page, {
      sourceName: "Firefox",
      file: {
        name: "passwords.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV_MIXED_FIREFOX),
      },
    });

    await expect(page.getByText("有效 1")).toBeVisible();
    await expect(page.getByText("警告 1")).toBeVisible();

    await confirmImport(page);

    await expect(page.getByText("已导入 1 条，已拒绝 1 条")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "密码列表" }).click();
    await expect(
      page.getByRole('button', { name: /编辑 secure.example.com/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /编辑 insecure.example.com/ }),
    ).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// F-05: Bitwarden JSON import
// ---------------------------------------------------------------------------

test.describe("Bitwarden JSON import", () => {
  test("F-05: imports a Bitwarden JSON entry", async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await runImportWizard(page, {
      sourceName: "Bitwarden",
      file: {
        name: "bitwarden.json",
        mimeType: "application/json",
        buffer: Buffer.from(BITWARDEN_JSON_FIXTURE),
      },
    });

    await expect(page.getByText("有效 1")).toBeVisible();

    await confirmImport(page);

    await expect(page.getByText("已导入 1 条")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "密码列表" }).click();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Bitwarden Import" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// F-06: 1Password CSV import
// ---------------------------------------------------------------------------

test.describe("1Password CSV import", () => {
  test("F-06: imports valid HTTPS entry and rejects HTTP entry", async ({
    page,
  }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await runImportWizard(page, {
      sourceName: "1Password",
      file: {
        name: "1password.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV_MIXED_1PASSWORD),
      },
    });

    await expect(page.getByText("有效 1")).toBeVisible();
    await expect(page.getByText("警告 1")).toBeVisible();

    await confirmImport(page);

    await expect(page.getByText("已导入 1 条，已拒绝 1 条")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "密码列表" }).click();
    await expect(
      page.getByRole('button', { name: /编辑 1Password HTTPS/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /编辑 insecure.example.com/ }),
    ).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// F-07: Generic JSON import
// ---------------------------------------------------------------------------

test.describe("Generic JSON import", () => {
  test("F-07: imports a generic JSON entry", async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await runImportWizard(page, {
      sourceName: "通用 JSON",
      file: {
        name: "generic.json",
        mimeType: "application/json",
        buffer: Buffer.from(GENERIC_JSON),
      },
    });

    await expect(page.getByText("有效 1")).toBeVisible();

    await confirmImport(page);

    await expect(page.getByText("已导入 1 条")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "密码列表" }).click();
    await expect(
      page
        .locator('button[aria-label]')
        .filter({ hasText: "Generic Import" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// F-08: Invalid file format
// ---------------------------------------------------------------------------

test.describe("Invalid file format", () => {
  test("F-08: shows error when uploading a .txt file", async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    // Select a source to enable navigation
    await page.getByLabel("Chrome").check();
    await page.getByRole("button", { name: "下一步" }).click();

    // Upload an unrecognised .txt file
    await page.getByLabel("选择导入文件").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this is not a password file"),
    });

    // Expect a parse/format error message
    await expect(
      page.getByText(/无法识别文件格式|文件解析失败|未能从文件中解析出有效凭据/u),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// F-09: Duplicate entry handling
// ---------------------------------------------------------------------------

test.describe("Duplicate entry handling", () => {
  test("F-09: detects duplicate rows in the preview", async ({ page }) => {
    const csvDuplicates = [
      "name,url,username,password",
      "Dup One,https://dup.example.com,user@example.com,DupPass!123",
      "Dup Two,https://dup.example.com,user@example.com,DupPass!456",
    ].join("\n");

    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await runImportWizard(page, {
      sourceName: "Chrome",
      file: {
        name: "duplicates.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvDuplicates),
      },
    });

    // Both rows should parse as valid
    await expect(page.getByText("有效 2")).toBeVisible();
    // Duplicate detection should flag at least one
    await expect(page.getByText(/重复 1|重复 2/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// F-10: Empty CSV file handling
// ---------------------------------------------------------------------------

test.describe("Empty CSV file handling", () => {
  test("F-10: shows error for a CSV with only headers", async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "导入密码" }).click();

    await page.getByLabel("Chrome").check();
    await page.getByRole("button", { name: "下一步" }).click();

    await page.getByLabel("选择导入文件").setInputFiles({
      name: "empty.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,url,username,password\n"),
    });

    // Expect error indicating no valid credentials were found
    await expect(
      page.getByText("未能从文件中解析出有效凭据"),
    ).toBeVisible();
  });
});
