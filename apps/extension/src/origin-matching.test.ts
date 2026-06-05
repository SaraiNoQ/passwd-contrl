import { describe, expect, it } from "vitest";
import {
  classifyAllMatches,
  classifyOriginMatch,
  exactOriginMatches,
  getEtldPlus1,
  hasPunycode
} from "./origin-matching";

const credentials = [
  {
    type: "login" as const,
    id: "1",
    title: "GitHub",
    origin: "https://github.com",
    username: "alice",
    password: "secret"
  }
];

describe("origin matching", () => {
  it("matches exact HTTPS origins", () => {
    expect(exactOriginMatches("https://github.com", credentials)).toHaveLength(1);
  });

  it("does not match HTTP or similar domains", () => {
    expect(exactOriginMatches("http://github.com", credentials)).toHaveLength(0);
    expect(exactOriginMatches("https://github.example.com", credentials)).toHaveLength(0);
  });
});

describe("getEtldPlus1", () => {
  it("extracts eTLD+1 from simple domains", () => {
    expect(getEtldPlus1("github.com")).toBe("github.com");
    expect(getEtldPlus1("login.example.com")).toBe("example.com");
    expect(getEtldPlus1("evil.sub.example.com")).toBe("example.com");
  });

  it("handles multi-part TLDs like .co.uk", () => {
    expect(getEtldPlus1("example.co.uk")).toBe("example.co.uk");
    expect(getEtldPlus1("login.example.co.uk")).toBe("example.co.uk");
  });

  it("handles single-label TLDs like localhost", () => {
    expect(getEtldPlus1("localhost")).toBe("localhost");
    expect(getEtldPlus1("sub.localhost")).toBe("localhost");
    expect(getEtldPlus1("deep.sub.localhost")).toBe("localhost");
  });
});

describe("hasPunycode", () => {
  it("detects punycode labels", () => {
    expect(hasPunycode("xn--googl-e4d.com")).toBe(true);
    expect(hasPunycode("xn--p1ai.ru")).toBe(true);
    expect(hasPunycode("example.com")).toBe(false);
    expect(hasPunycode("login.github.com")).toBe(false);
  });
});

describe("classifyOriginMatch", () => {
  it("returns exact for identical origins", () => {
    expect(classifyOriginMatch("https://example.com", "https://example.com")).toBe("exact");
  });

  it("returns different for different eTLD+1", () => {
    expect(classifyOriginMatch("https://example.com", "https://other.com")).toBe("different");
  });

  it("returns similar for same eTLD+1 but different subdomain", () => {
    expect(classifyOriginMatch("https://login.example.com", "https://evil.example.com")).toBe("similar");
  });

  it("returns suspicious for punycode origins", () => {
    expect(classifyOriginMatch("https://xn--googl-e4d.com", "https://google.com")).toBe("suspicious");
    expect(classifyOriginMatch("https://google.com", "https://xn--googl-e4d.com")).toBe("suspicious");
  });

  it("returns different for HTTP origins", () => {
    expect(classifyOriginMatch("http://example.com", "https://example.com")).toBe("different");
  });

  it("returns similar for localhost subdomains", () => {
    expect(classifyOriginMatch("https://localhost", "https://sub.localhost")).toBe("similar");
    expect(classifyOriginMatch("https://sub.localhost", "https://localhost")).toBe("similar");
  });
});

describe("classifyAllMatches", () => {
  it("returns only non-different matches with match type", () => {
    const creds = [
      { type: "login" as const, id: "1", title: "Exact", origin: "https://example.com", username: "a", password: "p" },
      { type: "login" as const, id: "2", title: "Similar", origin: "https://sub.example.com", username: "b", password: "p" },
      { type: "login" as const, id: "3", title: "Different", origin: "https://other.com", username: "c", password: "p" }
    ];
    const result = classifyAllMatches("https://example.com", creds);
    expect(result).toHaveLength(2);
    expect(result[0]!.matchType).toBe("exact");
    expect(result[1]!.matchType).toBe("similar");
  });

  it("returns empty for HTTP origins", () => {
    expect(classifyAllMatches("http://example.com", credentials)).toEqual([]);
  });
});
