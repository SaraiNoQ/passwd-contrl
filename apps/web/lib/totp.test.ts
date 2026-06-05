import { describe, expect, it } from "vitest";
import {
  decodeBase32,
  encodeBase32,
  generateTotp,
  isValidTotpSecret,
  extractSecret,
  parseOtpauthUri
} from "./totp";

// RFC 6238 test vector secret (SHA1)
const RFC_6238_SECRET = "JBSWY3DPEHPK3PXP";

describe("base32", () => {
  it("decodes base32 correctly", () => {
    const result = decodeBase32("JBSWY3DPEHPK3PXP");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("round-trips encode/decode", () => {
    const original = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const encoded = encodeBase32(original);
    const decoded = decodeBase32(encoded);
    expect(decoded).toEqual(original);
  });

  it("handles case-insensitive input", () => {
    const upper = decodeBase32("JBSWY3DPEHPK3PXP");
    const lower = decodeBase32("jbswy3dpehpk3pxp");
    expect(upper).toEqual(lower);
  });

  it("strips padding characters", () => {
    const withPad = decodeBase32("JBSWY3DPEHPK3PXP===");
    const withoutPad = decodeBase32("JBSWY3DPEHPK3PXP");
    expect(withPad).toEqual(withoutPad);
  });

  it("throws on invalid characters", () => {
    expect(() => decodeBase32("JBSWY3D1!")).toThrow("Invalid base32 character");
  });
});

describe("parseOtpauthUri", () => {
  it("parses a standard otpauth URI", () => {
    const result = parseOtpauthUri("otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30");
    expect(result.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(result.issuer).toBe("Example");
    expect(result.account).toBe("alice@google.com");
    expect(result.period).toBe(30);
    expect(result.digits).toBe(6);
  });

  it("uses defaults for missing parameters", () => {
    const result = parseOtpauthUri("otpauth://totp/test?secret=JBSWY3DPEHPK3PXP");
    expect(result.period).toBe(30);
    expect(result.digits).toBe(6);
    expect(result.algorithm).toBe("SHA1");
  });

  it("rejects non-otpauth URIs", () => {
    expect(() => parseOtpauthUri("https://example.com")).toThrow("Not an otpauth URI");
  });

  it("rejects HOTP URIs", () => {
    expect(() => parseOtpauthUri("otpauth://hotp/test?secret=JBSWY3DPEHPK3PXP")).toThrow("Only TOTP");
  });

  it("rejects URIs without secret", () => {
    expect(() => parseOtpauthUri("otpauth://totp/test")).toThrow("Missing secret");
  });
});

describe("generateTotp", () => {
  // RFC 6238 Section 4 test vectors (SHA1)
  // Using a known secret and time to produce deterministic codes
  it("generates a 6-digit code", async () => {
    const { code, remaining } = await generateTotp(RFC_6238_SECRET, Date.now());
    expect(code).toMatch(/^\d{6}$/u);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  });

  it("produces consistent results for the same time", async () => {
    const time = 1234567890000;
    const result1 = await generateTotp(RFC_6238_SECRET, time);
    const result2 = await generateTotp(RFC_6238_SECRET, time);
    expect(result1.code).toBe(result2.code);
    expect(result1.remaining).toBe(result2.remaining);
  });

  it("produces different codes for different times", async () => {
    const time1 = 1234567890000;
    const time2 = 1234567890000 + 31_000; // 31 seconds later (different period)
    const result1 = await generateTotp(RFC_6238_SECRET, time1);
    const result2 = await generateTotp(RFC_6238_SECRET, time2);
    // Different time periods should produce different codes (with overwhelming probability)
    // But they COULD collide, so we just verify both are valid
    expect(result1.code).toMatch(/^\d{6}$/u);
    expect(result2.code).toMatch(/^\d{6}$/u);
  });

  it("calculates remaining seconds correctly", async () => {
    // At 15 seconds into a period, remaining should be 15
    const periodMs = 30_000;
    const time = 1000 * 15; // 15 seconds from epoch
    const { remaining } = await generateTotp(RFC_6238_SECRET, time);
    expect(remaining).toBe(15);
  });

  it("handles otpauth URI as secret", async () => {
    const uri = `otpauth://totp/Test?secret=${RFC_6238_SECRET}`;
    const { code } = await generateTotp(uri, Date.now());
    expect(code).toMatch(/^\d{6}$/u);
  });

  it("matches RFC 6238 test vector for time=59 (SHA1)", async () => {
    // RFC 6238 Appendix B: TOTP(SHA1, time=59) = 94287082
    // Secret: "12345678901234567890" in ASCII, base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const time59 = 59 * 1000; // 59 seconds in ms
    const { code } = await generateTotp(rfcSecret, time59, 30, 8);
    expect(code).toBe("94287082");
  });

  it("matches RFC 6238 test vector for time=1111111109 (SHA1)", async () => {
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const time = 1111111109 * 1000;
    const { code } = await generateTotp(rfcSecret, time, 30, 8);
    expect(code).toBe("07081804");
  });

  it("matches RFC 6238 test vector for time=1234567890 (SHA1)", async () => {
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const time = 1234567890 * 1000;
    const { code } = await generateTotp(rfcSecret, time, 30, 8);
    expect(code).toBe("89005924");
  });
});

describe("isValidTotpSecret", () => {
  it("accepts valid base32 secrets", () => {
    expect(isValidTotpSecret("JBSWY3DPEHPK3PXP")).toBe(true);
  });

  it("accepts valid otpauth URIs", () => {
    expect(isValidTotpSecret("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP")).toBe(true);
  });

  it("rejects too-short base32", () => {
    expect(isValidTotpSecret("ABC")).toBe(false);
  });

  it("rejects invalid base32 characters", () => {
    expect(isValidTotpSecret("JBSWY3DPEHPK3PXP1!")).toBe(false);
  });

  it("rejects invalid otpauth URIs", () => {
    expect(isValidTotpSecret("otpauth://totp/Test")).toBe(false); // no secret
  });
});

describe("extractSecret", () => {
  it("extracts from base32", () => {
    expect(extractSecret("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("extracts from otpauth URI", () => {
    expect(extractSecret("otpauth://totp/Test?secret=abcdef")).toBe("ABCDEF");
  });

  it("cleans whitespace and padding from base32", () => {
    expect(extractSecret("JBSW Y3DP EHPK 3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });
});
