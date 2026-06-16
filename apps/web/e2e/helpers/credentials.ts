import { expect, type Page } from "@playwright/test";

export interface CredentialOpts {
  title: string;
  origin?: string;
  username?: string;
  password?: string;
  noteBody?: string;
  folder?: string;
  type?: "login" | "secure_note" | "credit_card";
  cardholderName?: string;
  cardNumber?: string;
  expirationMonth?: string;
  expirationYear?: string;
  cvv?: string;
  brand?: string;
}

/**
 * Open the create drawer, fill credential fields, save, and wait for
 * the new credential to appear in the list.
 */
export async function addCredential(
  page: Page,
  opts: CredentialOpts,
): Promise<void> {
  await page.getByRole("button", { name: "新增凭据" }).click();
  const drawer = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(drawer).toBeVisible();

  // Select type if not default login
  if (opts.type === "secure_note") {
    await drawer.getByRole("button", { name: "安全笔记" }).click();
  } else if (opts.type === "credit_card") {
    await drawer.getByRole("button", { name: "信用卡" }).click();
  }

  await drawer.getByLabel("标题").fill(opts.title);

  if (opts.type === "login" || !opts.type) {
    if (opts.origin) await drawer.getByLabel("网站地址").fill(opts.origin);
    if (opts.username) await drawer.getByLabel("用户名").fill(opts.username);
    if (opts.password) await drawer.locator("#credential-password").fill(opts.password);
  } else if (opts.type === "secure_note") {
    if (opts.noteBody) {
      await drawer.getByLabel("笔记内容").fill(opts.noteBody);
    }
  } else if (opts.type === "credit_card") {
    if (opts.cardholderName) await drawer.getByLabel("持卡人姓名").fill(opts.cardholderName);
    if (opts.cardNumber) await drawer.getByLabel("卡号").fill(opts.cardNumber);
    if (opts.expirationMonth) await drawer.getByLabel("到期月").fill(opts.expirationMonth);
    if (opts.expirationYear) await drawer.getByLabel("到期年").fill(opts.expirationYear);
    if (opts.cvv) await drawer.getByLabel("CVV").fill(opts.cvv);
    if (opts.brand) await drawer.getByLabel("卡品牌").fill(opts.brand);
  }

  // Fill folder if provided
  if (opts.folder) {
    const folderInput = drawer.locator('input[placeholder="未分类"]');
    await folderInput.fill(opts.folder);
  }

  // Save
  const saveButtonName = opts.type === "secure_note"
    ? "保存笔记"
    : opts.type === "credit_card"
      ? "保存信用卡"
      : "保存凭据";
  await drawer.getByRole("button", { name: saveButtonName }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  // Wait for credential to appear in list
  await expect(
    page.getByRole("button", { name: new RegExp(`编辑.*${opts.title}`) }),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Delete a credential by its title via the row's delete button.
 */
export async function deleteCredential(
  page: Page,
  title: string,
): Promise<void> {
  const row = page.locator('article').filter({ hasText: title });
  await row.locator('button[aria-label="删除"]').click();
  await row.locator('button').filter({ hasText: "确认" }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`编辑.*${title}`) }),
  ).toBeHidden({ timeout: 15_000 });
}

/**
 * Open credential drawer for editing by clicking on the credential row.
 */
export async function openCredentialForEdit(
  page: Page,
  title: string,
) {
  const row = page.getByRole("button", { name: new RegExp(`编辑.*${title}`) });
  await row.click();
  const drawer = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(drawer).toBeVisible({ timeout: 5_000 });
  await expect(drawer).toContainText("编辑凭据");
  return drawer;
}
