import { describe, it, expect } from "vitest";
import {
  decodeBase32,
  encodeBase32,
  parseOtpauthUri,
  generateTotp,
  isValidTotpSecret,
  extractSecret,
} from "../lib/totp";

describe("totp", () => {
  describe("decodeBase32 / encodeBase32", () => {
    it("round-trips a base32 secret", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const bytes = decodeBase32(secret);
      expect(encodeBase32(bytes)).toBe(secret);
    });

    it("ignores padding and whitespace", () => {
      const bytes = decodeBase32("JBSW Y3DP EHPK 3PXP");
      expect(encodeBase32(bytes)).toBe("JBSWY3DPEHPK3PXP");
    });

    it("throws on invalid characters", () => {
      expect(() => decodeBase32("JBSWY1")).toThrow("invalid_base32_character");
    });
  });

  describe("parseOtpauthUri", () => {
    it("parses a standard otpauth URI", () => {
      const parsed = parseOtpauthUri(
        "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
      );
      expect(parsed.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(parsed.issuer).toBe("Example");
      expect(parsed.account).toBe("alice@example.com");
      expect(parsed.period).toBe(30);
      expect(parsed.digits).toBe(6);
      expect(parsed.algorithm).toBe("SHA1");
    });

    it("uses query parameter overrides", () => {
      const parsed = parseOtpauthUri(
        "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&period=60&digits=8&algorithm=SHA256",
      );
      expect(parsed.period).toBe(60);
      expect(parsed.digits).toBe(8);
      expect(parsed.algorithm).toBe("SHA256");
    });

    it("throws on missing secret", () => {
      expect(() => parseOtpauthUri("otpauth://totp/Example:alice")).toThrow(
        "missing_otpauth_secret",
      );
    });

    it("throws on invalid protocol", () => {
      expect(() => parseOtpauthUri("https://example.com")).toThrow(
        "invalid_otpauth_uri",
      );
    });
  });

  describe("generateTotp", () => {
    it("generates a 6-digit code for a base32 secret", async () => {
      const result = await generateTotp("JBSWY3DPEHPK3PXP", 0);
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.remaining).toBeLessThanOrEqual(30);
    });

    it("generates a 6-digit code for an otpauth URI", async () => {
      const result = await generateTotp(
        "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP",
        0,
      );
      expect(result.code).toMatch(/^\d{6}$/);
    });

    it("is deterministic for the same time and secret", async () => {
      const time = 1234567890000;
      const r1 = await generateTotp("JBSWY3DPEHPK3PXP", time);
      const r2 = await generateTotp("JBSWY3DPEHPK3PXP", time);
      expect(r1.code).toBe(r2.code);
      expect(r1.remaining).toBe(r2.remaining);
    });

    it("changes when the time step changes", async () => {
      const r1 = await generateTotp("JBSWY3DPEHPK3PXP", 0);
      const r2 = await generateTotp("JBSWY3DPEHPK3PXP", 30000);
      expect(r1.code).not.toBe(r2.code);
    });
  });

  describe("isValidTotpSecret", () => {
    it("accepts a valid base32 secret", () => {
      expect(isValidTotpSecret("JBSWY3DPEHPK3PXP")).toBe(true);
    });

    it("accepts a valid otpauth URI", () => {
      expect(
        isValidTotpSecret(
          "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP",
        ),
      ).toBe(true);
    });

    it("rejects a short base32 secret", () => {
      expect(isValidTotpSecret("JBSW")).toBe(false);
    });

    it("rejects an invalid otpauth URI", () => {
      expect(isValidTotpSecret("otpauth://totp/Example:alice")).toBe(false);
    });
  });

  describe("extractSecret", () => {
    it("extracts secret from otpauth URI", () => {
      expect(
        extractSecret(
          "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP",
        ),
      ).toBe("JBSWY3DPEHPK3PXP");
    });

    it("normalizes a raw base32 secret", () => {
      expect(extractSecret("jbswy3dpehpk3pxp")).toBe("JBSWY3DPEHPK3PXP");
    });
  });
});
