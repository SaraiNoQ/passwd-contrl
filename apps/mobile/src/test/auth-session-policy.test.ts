import { describe, expect, it } from "vitest";
import { allowsOfflineSessionFallback } from "../lib/auth/offline-session-policy";

describe("offline session restore policy", () => {
  it("allows only explicit transport failures", () => {
    expect(allowsOfflineSessionFallback(new Error("network_error"))).toBe(true);
    expect(allowsOfflineSessionFallback(new Error("request_timeout"))).toBe(true);
    expect(allowsOfflineSessionFallback(
      Object.assign(new Error("request failed"), { code: "NETWORK_ERROR" }),
    )).toBe(true);
  });

  it("fails closed for identity, protocol and local-integrity errors", () => {
    for (const code of [
      "device_identity_mismatch",
      "device_not_trusted",
      "invalid_device_credential",
      "key_invalidated",
      "ciphertext_tampered",
      "invalid_session_response",
      "operation_cancelled",
    ]) {
      expect(allowsOfflineSessionFallback(
        Object.assign(new Error("restore failed"), { code }),
      )).toBe(false);
    }
    expect(allowsOfflineSessionFallback("network_error")).toBe(false);
  });
});
