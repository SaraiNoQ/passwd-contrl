import { beforeEach, describe, expect, it, vi } from "vitest";
import { fillFirstDetectedForm, isSafeToFill } from "./form-fill";

const visibleRect = {
  x: 0,
  y: 0,
  width: 160,
  height: 36,
  top: 0,
  right: 160,
  bottom: 36,
  left: 0,
  toJSON: () => ({})
};

const setLocation = (url: string) => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url)
  });
};

beforeEach(() => {
  document.body.innerHTML = "";
  setLocation("https://example.com/login");
  vi.restoreAllMocks();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(visibleRect);
});

describe("confirmed form fill", () => {
  it("fills visible username and password fields without submitting", () => {
    let submitted = false;
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" />
        <input type="password" />
        <button type="submit">Sign in</button>
      </form>
    `;
    document.querySelector("form")?.addEventListener("submit", () => {
      submitted = true;
    });

    const filled = fillFirstDetectedForm({
      type: "FILL_CREDENTIAL",
      username: "alice@example.com",
      password: "correct horse battery staple"
    });

    expect(filled).toBe(true);
    expect(document.querySelector<HTMLInputElement>("input[autocomplete='username']")?.value).toBe("alice@example.com");
    expect(document.querySelector<HTMLInputElement>("input[type='password']")?.value).toBe("correct horse battery staple");
    expect(submitted).toBe(false);
  });

  it("blocks fills on non-HTTPS pages", () => {
    setLocation("http://example.com/login");
    document.body.innerHTML = `<form><input autocomplete="username" /><input type="password" /></form>`;

    expect(fillFirstDetectedForm({ type: "FILL_CREDENTIAL", username: "alice", password: "secret" })).toBe(false);
    expect(document.querySelector<HTMLInputElement>("input[type='password']")?.value).toBe("");
  });

  it("does not fill hidden, disabled, or readonly password fields", () => {
    for (const attribute of ["hidden", "disabled", "readonly"]) {
      document.body.innerHTML = `<form><input autocomplete="username" /><input type="password" ${attribute} /></form>`;

      expect(fillFirstDetectedForm({ type: "FILL_CREDENTIAL", username: "alice", password: "secret" })).toBe(false);
      expect(document.querySelector<HTMLInputElement>("input[type='password']")?.value).toBe("");
    }
  });
});

describe("isSafeToFill", () => {
  it("rejects disabled fields", () => {
    document.body.innerHTML = `<input type="text" disabled />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects readonly fields", () => {
    document.body.innerHTML = `<input type="text" readonly />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects hidden type fields", () => {
    document.body.innerHTML = `<input type="hidden" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects zero-dimension fields", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({})
    });
    document.body.innerHTML = `<input type="text" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects display:none fields", () => {
    document.body.innerHTML = `<input type="text" style="display:none" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("accepts visible enabled fields", () => {
    document.body.innerHTML = `<input type="text" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(true);
  });
});
