import { describe, it, expect } from "vitest";
import { generate, generatePassword, type GeneratorOptions } from "../components/tools/password-generator";

describe("password-generator", () => {
  // ── generate ─────────────────────────────────────────────────────────────

  describe("generate", () => {
    const baseOpts: GeneratorOptions = {
      length: 20,
      includeUpper: true,
      includeLower: true,
      includeDigits: true,
      includeSymbols: true,
      excludeSimilar: false,
      excludeAmbiguous: false,
    };

    it("respects the specified length", () => {
      for (const len of [8, 16, 32, 64, 128]) {
        const pw = generate({ ...baseOpts, length: len });
        expect(pw).toHaveLength(len);
      }
    });

    it("returns empty string when no character sets are selected", () => {
      const pw = generate({
        ...baseOpts,
        includeUpper: false,
        includeLower: false,
        includeDigits: false,
        includeSymbols: false,
      });
      expect(pw).toBe("");
    });

    it("generates only uppercase when only uppercase is selected", () => {
      const pw = generate({
        ...baseOpts,
        length: 100,
        includeUpper: true,
        includeLower: false,
        includeDigits: false,
        includeSymbols: false,
      });
      expect(pw).toMatch(/^[A-Z]+$/);
    });

    it("generates only lowercase when only lowercase is selected", () => {
      const pw = generate({
        ...baseOpts,
        length: 100,
        includeUpper: false,
        includeLower: true,
        includeDigits: false,
        includeSymbols: false,
      });
      expect(pw).toMatch(/^[a-z]+$/);
    });

    it("generates only digits when only digits are selected", () => {
      const pw = generate({
        ...baseOpts,
        length: 100,
        includeUpper: false,
        includeLower: false,
        includeDigits: true,
        includeSymbols: false,
      });
      expect(pw).toMatch(/^[0-9]+$/);
    });

    it("generates only symbols when only symbols are selected", () => {
      const pw = generate({
        ...baseOpts,
        length: 100,
        includeUpper: false,
        includeLower: false,
        includeDigits: false,
        includeSymbols: true,
      });
      expect(pw).toMatch(/^[!@#$%^&*]+$/);
    });

    it("excludes similar characters when excludeSimilar is true", () => {
      const similarChars = new Set(["i", "l", "1", "L", "o", "0", "O", "I"]);
      // Run multiple times to increase confidence
      for (let attempt = 0; attempt < 10; attempt++) {
        const pw = generate({
          ...baseOpts,
          length: 200,
          excludeSimilar: true,
        });
        for (const ch of pw) {
          expect(similarChars.has(ch)).toBe(false);
        }
      }
    });

    it("excludes ambiguous characters when excludeAmbiguous is true", () => {
      const ambiguousChars = new Set([
        "{", "}", "[", "]", "(", ")", "/", "\\",
        "'", '"', "`", "~", ",", ";", ".", "<", ">",
      ]);
      for (let attempt = 0; attempt < 10; attempt++) {
        const pw = generate({
          ...baseOpts,
          length: 200,
          excludeAmbiguous: true,
        });
        for (const ch of pw) {
          expect(ambiguousChars.has(ch)).toBe(false);
        }
      }
    });

    it("produces different passwords on successive calls (randomness)", () => {
      const passwords = new Set<string>();
      const count = 20;
      for (let i = 0; i < count; i++) {
        passwords.add(generate(baseOpts));
      }
      // With a 20-char password from a large charset, collisions are
      // astronomically unlikely.  Expect all unique.
      expect(passwords.size).toBe(count);
    });

    it("produces a length-0 string when length is 0", () => {
      const pw = generate({ ...baseOpts, length: 0 });
      expect(pw).toHaveLength(0);
    });
  });

  // ── generatePassword (convenience) ───────────────────────────────────────

  describe("generatePassword", () => {
    it("generates a password with default options", () => {
      const pw = generatePassword();
      expect(pw).toHaveLength(20);
      // Default includes all charsets, so should contain a mix
      expect(pw.length).toBeGreaterThan(0);
    });

    it("accepts partial options", () => {
      const pw = generatePassword({ length: 32 });
      expect(pw).toHaveLength(32);
    });

    it("accepts length override", () => {
      const pw = generatePassword({ length: 8 });
      expect(pw).toHaveLength(8);
    });
  });
});
