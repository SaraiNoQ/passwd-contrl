import { describe, it, expect } from "vitest";
import {
  extractSearchTerms,
  generateSearchTokens,
  generateQueryToken,
} from "../lib/search-tokens";
import type { VaultItem } from "@zero-vault/shared";

function makeLogin(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "login",
    title: "My Bank Login",
    origin: "https://www.bank.example.com/login",
    username: "john.doe@example.com",
    password: "secret",
    folder: "",
    notes: "",
    customFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as VaultItem;
}

function makeSecureNote(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    type: "secure_note",
    title: "Important Note",
    noteBody: "contents",
    folder: "",
    notes: "",
    customFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as VaultItem;
}

function makeCreditCard(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    type: "credit_card",
    title: "Visa Card",
    cardholderName: "John Doe",
    cardNumber: "4111111111111111",
    expirationMonth: "12",
    expirationYear: "2030",
    cvv: "123",
    brand: "visa",
    folder: "",
    notes: "",
    customFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as VaultItem;
}

describe("search-tokens", () => {
  describe("extractSearchTerms", () => {
    it("extracts title terms for all item types", () => {
      const terms = extractSearchTerms(makeLogin({ title: "Hello World" }));
      expect(terms).toContain("hello");
      expect(terms).toContain("world");
    });

    it("skips short terms", () => {
      const terms = extractSearchTerms(makeSecureNote({ title: "a bc def" }));
      expect(terms).not.toContain("a");
      expect(terms).toContain("bc");
      expect(terms).toContain("def");
    });

    it("extracts hostname labels from login origin", () => {
      const terms = extractSearchTerms(makeLogin());
      expect(terms).toContain("bank");
      expect(terms).toContain("example");
      expect(terms).not.toContain("www");
    });

    it("extracts username parts from login", () => {
      const terms = extractSearchTerms(makeLogin());
      expect(terms).toContain("john");
      expect(terms).toContain("doe");
      expect(terms).toContain("example");
      expect(terms).toContain("com");
    });

    it("handles login with invalid origin", () => {
      const terms = extractSearchTerms(makeLogin({ origin: "not-a-url" }));
      expect(terms).toContain("my");
      expect(terms).toContain("bank");
      expect(terms).toContain("login");
    });

    it("extracts only title terms from secure notes", () => {
      const terms = extractSearchTerms(makeSecureNote({ title: "Note Title" }));
      expect(terms).toContain("note");
      expect(terms).toContain("title");
      expect(terms).not.toContain("contents");
    });

    it("extracts cardholder name and brand from credit cards", () => {
      const terms = extractSearchTerms(makeCreditCard());
      expect(terms).toContain("john");
      expect(terms).toContain("doe");
      expect(terms).toContain("visa");
    });

    it("deduplicates terms", () => {
      const terms = extractSearchTerms(
        makeLogin({
          title: "Example Example",
          origin: "https://example.com",
          username: "user@example.com",
        }),
      );
      expect(terms.filter((t) => t === "example")).toHaveLength(1);
    });
  });

  describe("generateSearchTokens", () => {
    it("returns empty array when there are no terms", async () => {
      const tokens = await generateSearchTokens(
        new Uint8Array(32),
        makeSecureNote({ title: "x" }),
      );
      expect(tokens).toEqual([]);
    });

    it("returns HMAC_SHA256 envelopes", async () => {
      const tokens = await generateSearchTokens(
        new Uint8Array(32),
        makeLogin({ title: "Hello World" }),
      );
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(token.alg).toBe("HMAC_SHA256");
        expect(token.nonce).toBe("AA");
        expect(token.ciphertext).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it("produces deterministic tokens for the same key and term", async () => {
      const key = new Uint8Array(32);
      key.fill(42);
      const item = makeLogin({ title: "Unique Title" });
      const tokens1 = await generateSearchTokens(key, item);
      const tokens2 = await generateSearchTokens(key, item);
      expect(tokens1).toEqual(tokens2);
    });

    it("produces different tokens for different keys", async () => {
      const key1 = new Uint8Array(32);
      key1.fill(1);
      const key2 = new Uint8Array(32);
      key2.fill(2);
      const item = makeLogin({ title: "Unique Title" });
      const tokens1 = await generateSearchTokens(key1, item);
      const tokens2 = await generateSearchTokens(key2, item);
      expect(tokens1).not.toEqual(tokens2);
    });
  });

  describe("generateQueryToken", () => {
    it("returns empty string for short queries", async () => {
      const token = await generateQueryToken(new Uint8Array(32), "x");
      expect(token).toBe("");
    });

    it("returns a lowercase hex string for valid queries", async () => {
      const token = await generateQueryToken(new Uint8Array(32), "hello");
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("matches tokens generated for the same term", async () => {
      const key = new Uint8Array(32);
      key.fill(42);
      const item = makeLogin({ title: "hello" });
      const tokens = await generateSearchTokens(key, item);
      const queryToken = await generateQueryToken(key, "hello");
      expect(tokens.map((t) => t.ciphertext)).toContain(queryToken);
    });
  });
});
