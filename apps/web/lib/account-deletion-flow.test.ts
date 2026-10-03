import { describe, expect, it } from "vitest";
import {
  RECENT_ACCOUNT_AUTH_WINDOW_MS,
  accountEmailsMatch,
  isRecentAccountAuthentication,
  normalizeAccountEmail,
} from "./account-deletion-flow";

describe("account deletion confirmation", () => {
  it("normalizes only email whitespace and casing", () => {
    expect(normalizeAccountEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(accountEmailsMatch("User@Example.com", " user@example.COM ")).toBe(true);
    expect(accountEmailsMatch("user@example.com", "other@example.com")).toBe(false);
  });

  it("accepts only a fresh, non-future authentication", () => {
    const now = 10_000_000;
    expect(isRecentAccountAuthentication(now, now)).toBe(true);
    expect(
      isRecentAccountAuthentication(now - RECENT_ACCOUNT_AUTH_WINDOW_MS, now),
    ).toBe(true);
    expect(
      isRecentAccountAuthentication(now - RECENT_ACCOUNT_AUTH_WINDOW_MS - 1, now),
    ).toBe(false);
    expect(isRecentAccountAuthentication(now + 1, now)).toBe(false);
  });
});
