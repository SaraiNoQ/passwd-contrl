import { describe, it, expect } from "vitest";
import { extractSearchTerms } from "./search-tokens";
import type { VaultItem } from "./local-vault";

describe("extractSearchTerms", () => {
  it("extracts title words from login items", () => {
    const item = {
      id: "1",
      type: "login",
      title: "GitHub Account",
      origin: "https://github.com",
      username: "user@example.com",
      password: "pass",
      notes: "",
      folder: "",
      createdAt: "",
      updatedAt: "",
    } as VaultItem;
    const terms = extractSearchTerms(item);
    expect(terms).toContain("github");
    expect(terms).toContain("account");
  });

  it("extracts hostname labels from origin", () => {
    const item = {
      id: "1",
      type: "login",
      title: "Test",
      origin: "https://www.example.com/login",
      username: "user",
      password: "pass",
      notes: "",
      folder: "",
      createdAt: "",
      updatedAt: "",
    } as VaultItem;
    const terms = extractSearchTerms(item);
    expect(terms).toContain("example");
    expect(terms).toContain("com");
    expect(terms).not.toContain("www");
  });

  it("extracts username parts", () => {
    const item = {
      id: "1",
      type: "login",
      title: "Test",
      origin: "https://test.com",
      username: "john.doe@example.com",
      password: "pass",
      notes: "",
      folder: "",
      createdAt: "",
      updatedAt: "",
    } as VaultItem;
    const terms = extractSearchTerms(item);
    expect(terms).toContain("john");
    expect(terms).toContain("doe");
    expect(terms).toContain("example");
  });

  it("skips terms shorter than 2 chars", () => {
    const item = {
      id: "1",
      type: "login",
      title: "A B Test",
      origin: "https://test.com",
      username: "x",
      password: "pass",
      notes: "",
      folder: "",
      createdAt: "",
      updatedAt: "",
    } as VaultItem;
    const terms = extractSearchTerms(item);
    expect(terms).not.toContain("a");
    expect(terms).not.toContain("b");
    expect(terms).toContain("test");
  });

  it("extracts title words from secure notes", () => {
    const item = {
      id: "1",
      type: "secure_note",
      title: "Important Document",
      noteBody: "secret content",
      notes: "",
      folder: "",
      createdAt: "",
      updatedAt: "",
    } as unknown as VaultItem;
    const terms = extractSearchTerms(item);
    expect(terms).toContain("important");
    expect(terms).toContain("document");
  });

  it("returns empty array for items with no searchable content", () => {
    const item = {
      id: "1",
      type: "login",
      title: "",
      origin: "https://x.co",
      username: "",
      password: "pass",
      notes: "",
      folder: "",
      createdAt: "",
      updatedAt: "",
    } as VaultItem;
    const terms = extractSearchTerms(item);
    // "co" is 2 chars, should be included
    expect(terms).toContain("co");
  });
});
