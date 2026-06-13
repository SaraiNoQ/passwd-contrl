/**
 * Tests for SettingsPage component.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SettingsPage } from "../components/settings/settings-page";

// ── Helpers ─────────────────────────────────────────────────────────────

function renderSettings(
  overrides: Partial<React.ComponentProps<typeof SettingsPage>> = {},
) {
  const defaultProps = {
    autoLockMinutes: 5,
    onAutoLockChange: vi.fn(),
    loading: false,
    ...overrides,
  };
  return render(<SettingsPage {...defaultProps} />);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("SettingsPage", () => {
  it("renders the settings page title", () => {
    const { container } = renderSettings();
    const title = container.querySelector("#settings-title");
    expect(title?.textContent).toBe("设置");
  });

  it("displays the current auto-lock timeout in the hero summary", () => {
    const { container } = renderSettings({ autoLockMinutes: 15 });
    const summary = container.querySelector('[aria-label="当前设置摘要"]');
    expect(summary?.textContent).toContain("15");
    expect(summary?.textContent).toContain("分钟");
  });

  it("renders auto-lock section with select", () => {
    const { container } = renderSettings();
    const select = container.querySelector(
      'select[aria-label="自动锁定时间"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("5");
  });

  it("auto-lock select has the correct value for 10 minutes", () => {
    const { container } = renderSettings({ autoLockMinutes: 10 });
    const select = container.querySelector(
      'select[aria-label="自动锁定时间"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe("10");
  });

  it("calls onAutoLockChange when select value changes", () => {
    const onAutoLockChange = vi.fn();
    const { container } = renderSettings({ onAutoLockChange });
    const select = container.querySelector(
      'select[aria-label="自动锁定时间"]',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "30" } });
    expect(onAutoLockChange).toHaveBeenCalledWith(30);
  });

  it("renders all auto-lock options", () => {
    const { container } = renderSettings();
    const select = container.querySelector(
      'select[aria-label="自动锁定时间"]',
    ) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["1", "5", "10", "15", "30", "60"]);
  });

  it("renders master password section with form", () => {
    const { container } = renderSettings();
    const headings = container.querySelectorAll("h3");
    const titles = Array.from(headings).map((h) => h.textContent);
    expect(titles).toContain("主密码");
    expect(container.textContent).toContain("修改主密码");
  });

  it("renders password input fields", () => {
    const { container } = renderSettings();
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBe(3); // current, new, confirm
  });

  it("renders export section", () => {
    const { container } = renderSettings();
    const headings = container.querySelectorAll("h3");
    const titles = Array.from(headings).map((h) => h.textContent);
    expect(titles).toContain("数据导出");
    expect(container.textContent).toContain("导出 CSV");
    expect(container.textContent).toContain("导出加密备份");
  });

  it("renders account section with delete button", () => {
    const { container } = renderSettings();
    const headings = container.querySelectorAll("h3");
    const titles = Array.from(headings).map((h) => h.textContent);
    expect(titles).toContain("账户");
    const deleteBtn = container.querySelector('button[class*="danger"]');
    expect(deleteBtn?.textContent).toBe("删除账户");
  });

  it("renders about section with version info", () => {
    const { container } = renderSettings();
    const headings = container.querySelectorAll("h3");
    const titles = Array.from(headings).map((h) => h.textContent);
    expect(titles).toContain("关于");
    expect(container.textContent).toContain("v0.1.0");
    expect(container.textContent).toContain("Tauri 2.x + React");
    expect(container.textContent).toContain("Argon2id + XChaCha20-Poly1305");
  });

  it("shows delete confirmation modal when delete button is clicked", () => {
    const onDeleteAccount = vi.fn().mockResolvedValue(undefined);
    const { container } = renderSettings({ onDeleteAccount });
    // Find the delete button - it's a button with text "删除账户" that has a danger class
    const buttons = Array.from(container.querySelectorAll("button"));
    const deleteBtn = buttons.find(
      (b) => b.textContent === "删除账户" && b.className.includes("danger"),
    );
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn!.disabled).toBe(false);
    fireEvent.click(deleteBtn!);
    // After clicking, the modal should appear
    expect(container.textContent).toContain("确认删除账户");
    expect(container.textContent).toContain("确认删除");
  });

  it("closes delete modal when cancel is clicked", () => {
    const onDeleteAccount = vi.fn().mockResolvedValue(undefined);
    const { container } = renderSettings({ onDeleteAccount });
    const buttons = Array.from(container.querySelectorAll("button"));
    const deleteBtn = buttons.find(
      (b) => b.textContent === "删除账户" && b.className.includes("danger"),
    );
    fireEvent.click(deleteBtn!);
    // Find the cancel button in the modal
    const allButtons = Array.from(container.querySelectorAll("button"));
    const cancelBtn = allButtons.find((b) => b.textContent === "取消");
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn!);
    expect(container.textContent).not.toContain("确认删除账户");
  });

  it("disables select when loading", () => {
    const { container } = renderSettings({ loading: true });
    const select = container.querySelector(
      'select[aria-label="自动锁定时间"]',
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
