import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectForms } from "./form-detection";

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL("https://example.com/login")
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 120,
    height: 32,
    top: 0,
    right: 120,
    bottom: 32,
    left: 0,
    toJSON: () => ({})
  });
});

describe("form detection", () => {
  it("detects visible username and password fields", () => {
    document.body.innerHTML = `<form><input type="email" /><input type="password" /></form>`;
    expect(detectForms()).toEqual([
      expect.objectContaining({
        usernameFieldId: expect.any(String),
        passwordFieldId: expect.any(String)
      })
    ]);
  });

  it("ignores hidden password fields", () => {
    document.body.innerHTML = `<form><input type="password" hidden /></form>`;
    expect(detectForms()).toEqual([]);
  });

  it("ignores disabled password fields", () => {
    document.body.innerHTML = `<form><input type="email" /><input type="password" disabled /></form>`;
    expect(detectForms()).toEqual([]);
  });

  it("ignores readonly password fields", () => {
    document.body.innerHTML = `<form><input type="email" /><input type="password" readonly /></form>`;
    expect(detectForms()).toEqual([]);
  });

  it("detects username by autocomplete attribute", () => {
    document.body.innerHTML = `<form><input autocomplete="username" /><input type="password" /></form>`;
    const forms = detectForms();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.usernameFieldId).toBeDefined();
  });

  it("detects username by name attribute", () => {
    document.body.innerHTML = `<form><input name="username" /><input type="password" /></form>`;
    const forms = detectForms();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.usernameFieldId).toBeDefined();
  });

  it("detects username by id attribute", () => {
    document.body.innerHTML = `<form><input id="email" /><input type="password" /></form>`;
    const forms = detectForms();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.usernameFieldId).toBeDefined();
  });

  it("skips forms on non-HTTPS pages", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("http://example.com/login")
    });
    document.body.innerHTML = `<form><input type="email" /><input type="password" /></form>`;
    expect(detectForms()).toEqual([]);
  });
});
