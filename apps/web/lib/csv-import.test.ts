import { describe, expect, it } from "vitest";
import { parsePasswordCsv } from "./csv-import";

describe("CSV import parser", () => {
  it("parses common browser password exports", () => {
    const parsed = parsePasswordCsv(`name,url,username,password\nGitHub,https://github.com,alice,secret`);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      origin: "https://github.com",
      username: "alice",
      password: "secret",
      title: "GitHub"
    });
  });

  it("rejects invalid rows", () => {
    const parsed = parsePasswordCsv(`url,username,password\nnot-a-url,alice,secret`);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.rejected).toBe(1);
  });
});
