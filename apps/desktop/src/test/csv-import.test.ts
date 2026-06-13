import { describe, expect, it } from "vitest";
import {
  parsePasswordCsv,
  detectImportFormat,
  parsePasswordImport,
  autoDetectMapping,
} from "../lib/csv-import";

// ---------------------------------------------------------------------------
// parsePasswordCsv
// ---------------------------------------------------------------------------

describe("parsePasswordCsv", () => {
  it("parses common browser password exports (Chrome format)", () => {
    const csv = `name,url,username,password,note
GitHub,https://github.com,alice,secret123,my note`;
    const result = parsePasswordCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://github.com",
      username: "alice",
      password: "secret123",
      title: "GitHub",
      notes: "my note",
    });
    expect(result.headers).toEqual(["name", "url", "username", "password", "note"]);
  });

  it("parses Firefox CSV exports (signon_realm)", () => {
    const csv = `signon_realm,username,password
https://example.com,bob,pass456`;
    const result = parsePasswordCsv(csv, {
      origin: "signon_realm",
      username: "username",
      password: "password",
      title: "",
      notes: "",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://example.com",
      username: "bob",
      password: "pass456",
    });
  });

  it("rejects rows with invalid URLs", () => {
    const csv = `url,username,password
not-a-url,alice,secret`;
    const result = parsePasswordCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it("rejects rows with empty passwords", () => {
    const csv = `url,username,password
https://example.com,alice,`;
    const result = parsePasswordCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it("handles quoted fields with commas", () => {
    const csv = `name,url,username,password
"My Site, Inc",https://example.com,alice,"pass,word"`;
    const result = parsePasswordCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      title: "My Site, Inc",
      password: "pass,word",
    });
  });

  it("handles escaped quotes inside quoted fields", () => {
    const csv = `name,url,username,password
"My ""Site""",https://example.com,alice,secret`;
    const result = parsePasswordCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toBe('My "Site"');
  });

  it("returns empty for fewer than 2 lines", () => {
    const result = parsePasswordCsv("url,username,password");
    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toBe(0);
  });

  it("strips BOM from CSV content", () => {
    const csv = `﻿name,url,username,password
GitHub,https://github.com,alice,secret`;
    const result = parsePasswordCsv(csv);
    expect(result.rows).toHaveLength(1);
  });

  it("handles LastPass CSV with grouping and totp columns", () => {
    const csv = `url,username,password,totp,extra,name,grouping,fav
https://example.com,user1,pass1,,,"Example","Social",0`;
    const result = parsePasswordCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://example.com",
      username: "user1",
      password: "pass1",
      title: "Example",
    });
  });
});

// ---------------------------------------------------------------------------
// detectImportFormat
// ---------------------------------------------------------------------------

describe("detectImportFormat", () => {
  it("detects Chrome CSV by headers", () => {
    const content = `name,url,username,password,note\nGitHub,https://github.com,alice,secret,`;
    expect(detectImportFormat(content, "passwords.csv")).toBe("chrome");
  });

  it("detects Firefox CSV by signon_realm header", () => {
    const content = `signon_realm,username,password\nhttps://example.com,bob,pass`;
    expect(detectImportFormat(content, "logins.csv")).toBe("firefox");
  });

  it("detects Bitwarden JSON", () => {
    const content = JSON.stringify({
      encrypted: false,
      items: [{ login: { username: "a", password: "b" } }],
    });
    expect(detectImportFormat(content, "export.json")).toBe("bitwarden");
  });

  it("detects generic JSON array", () => {
    const content = JSON.stringify([
      { url: "https://example.com", username: "a", password: "b" },
    ]);
    expect(detectImportFormat(content, "logins.json")).toBe("generic-json");
  });

  it("detects 1PUX by extension", () => {
    expect(detectImportFormat("binary-data", "export.1pux")).toBe("1password");
  });

  it("detects 1Password CSV by login_uri header", () => {
    const content = `title,login_uri,login_username,login_password\nTest,https://example.com,a,b`;
    expect(detectImportFormat(content, "1password.csv")).toBe("1password");
  });

  it("detects LastPass CSV by grouping column", () => {
    const content = `url,username,password,totp,extra,name,grouping,fav\nhttps://example.com,a,b,,,Test,Group,0`;
    expect(detectImportFormat(content, "lastpass.csv")).toBe("lastpass");
  });

  it("returns unknown for unrecognizable content", () => {
    expect(detectImportFormat("hello world", "file.txt")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// autoDetectMapping
// ---------------------------------------------------------------------------

describe("autoDetectMapping", () => {
  it("maps Chrome headers correctly", () => {
    const mapping = autoDetectMapping(["name", "url", "username", "password", "note"]);
    expect(mapping).toMatchObject({
      origin: "url",
      username: "username",
      password: "password",
      title: "name",
      notes: "note",
    });
  });

  it("maps Firefox headers correctly", () => {
    const mapping = autoDetectMapping(["signon_realm", "username", "password"]);
    expect(mapping).toMatchObject({
      origin: "signon_realm",
      username: "username",
      password: "password",
    });
  });

  it("returns empty strings for unmapped columns", () => {
    const mapping = autoDetectMapping(["foo", "bar"]);
    expect(mapping.origin).toBe("");
    expect(mapping.password).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parsePasswordImport (unified entry point)
// ---------------------------------------------------------------------------

describe("parsePasswordImport", () => {
  it("parses CSV format", () => {
    const csv = `url,username,password\nhttps://github.com,alice,secret`;
    const result = parsePasswordImport(csv, "csv");
    expect(result.rows).toHaveLength(1);
  });

  it("parses Bitwarden JSON format", () => {
    const json = JSON.stringify({
      encrypted: false,
      items: [
        {
          name: "GitHub",
          login: {
            username: "alice",
            password: "secret",
            uris: [{ uri: "https://github.com" }],
          },
        },
      ],
    });
    const result = parsePasswordImport(json, "bitwarden");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://github.com",
      username: "alice",
      password: "secret",
      title: "GitHub",
    });
  });

  it("parses generic JSON format", () => {
    const json = JSON.stringify([
      { url: "https://example.com", username: "bob", password: "pass123" },
    ]);
    const result = parsePasswordImport(json, "generic-json");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://example.com",
      username: "bob",
      password: "pass123",
    });
  });

  it("returns empty for unknown format", () => {
    const result = parsePasswordImport("anything", "unknown");
    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toBe(0);
  });
});
