import { describe, expect, it } from "vitest";
import {
  detectImportFormat,
  parsePasswordImport,
  type ImportFormat,
} from "./password-import";

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

describe("detectImportFormat", () => {
  it("detects Bitwarden JSON export", () => {
    const content = JSON.stringify({
      encrypted: false,
      items: [
        {
          name: "Example",
          login: {
            username: "user",
            password: "pass",
            uris: [{ uri: "https://example.com" }],
          },
        },
      ],
    });
    expect(detectImportFormat(content, "export.json")).toBe("bitwarden");
  });

  it("detects generic JSON array", () => {
    const content = JSON.stringify([
      { name: "Site", url: "https://example.com", username: "alice", password: "secret" },
    ]);
    expect(detectImportFormat(content, "data.json")).toBe("generic-json");
  });

  it("detects CSV by headers", () => {
    expect(detectImportFormat("name,url,username,password\nGitHub,https://github.com,alice,secret", "export.csv")).toBe("csv");
  });

  it("detects 1password CSV by headers", () => {
    expect(detectImportFormat("Title,URL,Username,Password,Notes,OTPAuth\nexample,https://x.com,user,pass,note,", "export.csv")).toBe("csv");
  });

  it("detects 1password by .1pux extension", () => {
    // Simulate binary/zip content that won't parse as JSON or CSV
    expect(detectImportFormat("PK", "export.1pux")).toBe("1password");
  });

  it("returns unknown for unrecognized content", () => {
    expect(detectImportFormat("not valid data", "file.txt")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Bitwarden parser
// ---------------------------------------------------------------------------

describe("parsePasswordImport - bitwarden", () => {
  const format: ImportFormat = "bitwarden";

  it("parses a standard Bitwarden export", () => {
    const content = JSON.stringify({
      encrypted: false,
      items: [
        {
          name: "Example",
          login: {
            username: "user@example.com",
            password: "mypassword",
            uris: [{ uri: "https://example.com" }],
          },
          notes: "some note",
        },
      ],
    });
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://example.com",
      username: "user@example.com",
      password: "mypassword",
      title: "Example",
      notes: "some note",
    });
  });

  it("creates one entry per URI", () => {
    const content = JSON.stringify({
      encrypted: false,
      items: [
        {
          name: "Multi-URI",
          login: {
            username: "user",
            password: "pass",
            uris: [
              { uri: "https://a.com" },
              { uri: "https://b.com" },
            ],
          },
        },
      ],
    });
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.origin).toBe("https://a.com");
    expect(result.rows[1]!.origin).toBe("https://b.com");
  });

  it("skips items with empty passwords", () => {
    const content = JSON.stringify({
      encrypted: false,
      items: [
        {
          name: "No Password",
          login: { username: "user", password: "", uris: [{ uri: "https://x.com" }] },
        },
      ],
    });
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it("handles null/undefined values gracefully", () => {
    const content = JSON.stringify({
      encrypted: false,
      items: [
        { name: null, login: { username: null, password: "pass", uris: [{ uri: "https://x.com" }] } },
      ],
    });
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.username).toBe("");
    expect(result.rows[0]!.title).toBeUndefined();
  });

  it("returns empty for invalid JSON", () => {
    const result = parsePasswordImport("{not json", format);
    expect(result.rows).toHaveLength(0);
  });

  it("returns empty for empty items", () => {
    const result = parsePasswordImport(JSON.stringify({ encrypted: false }), format);
    expect(result.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Generic JSON parser
// ---------------------------------------------------------------------------

describe("parsePasswordImport - generic-json", () => {
  const format: ImportFormat = "generic-json";

  it("parses name/url/username/password objects", () => {
    const content = JSON.stringify([
      { name: "GitHub", url: "https://github.com", username: "alice", password: "secret" },
    ]);
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://github.com",
      username: "alice",
      password: "secret",
      title: "GitHub",
    });
  });

  it("parses title/origin variants", () => {
    const content = JSON.stringify([
      { title: "Site", origin: "https://example.com", username: "bob", password: "pass123" },
    ]);
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.title).toBe("Site");
    expect(result.rows[0]!.origin).toBe("https://example.com");
  });

  it("skips entries without password", () => {
    const content = JSON.stringify([
      { name: "A", url: "https://a.com", username: "u", password: "" },
      { name: "B", url: "https://b.com", username: "u", password: "pass" },
    ]);
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });

  it("returns empty for invalid JSON", () => {
    const result = parsePasswordImport("not json", format);
    expect(result.rows).toHaveLength(0);
  });

  it("returns empty for non-array JSON", () => {
    const result = parsePasswordImport(JSON.stringify({ key: "val" }), format);
    expect(result.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 1Password parser
// ---------------------------------------------------------------------------

describe("parsePasswordImport - 1password", () => {
  const format: ImportFormat = "1password";

  it("parses 1Password CSV export", () => {
    const content = "Title,URL,Username,Password,Notes\nExample,https://example.com,user,pass,my notes";
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://example.com",
      username: "user",
      password: "pass",
      title: "Example",
      notes: "my notes",
    });
  });

  it("returns empty for binary 1PUX content", () => {
    // Binary content that wouldn't be valid CSV or JSON
    const result = parsePasswordImport("PKbinaryzipdata", format);
    expect(result.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CSV parser (via parsePasswordImport)
// ---------------------------------------------------------------------------

describe("parsePasswordImport - csv", () => {
  const format: ImportFormat = "csv";

  it("parses standard browser CSV", () => {
    const content = "name,url,username,password\nGitHub,https://github.com,alice,secret";
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      origin: "https://github.com",
      username: "alice",
      password: "secret",
      title: "GitHub",
    });
  });

  it("rejects rows with invalid URLs", () => {
    const content = "url,username,password\nnot-a-url,alice,secret";
    const result = parsePasswordImport(content, format);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });
});
