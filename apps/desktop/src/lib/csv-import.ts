import type { ImportLoginRow } from "@zero-vault/shared";
import { importLoginRowSchema } from "@zero-vault/shared";

// ---------------------------------------------------------------------------
// CSV line parser (handles quoted fields, escaped quotes)
// ---------------------------------------------------------------------------

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
};

const normalizeHeader = (header: string) =>
  header.trim().toLowerCase().replaceAll(" ", "_");

const pick = (row: Record<string, string>, names: string[]) => {
  for (const name of names) {
    const value = row[name];
    if (value) {
      return value;
    }
  }
  return "";
};

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export type ImportFormat =
  | "chrome"
  | "firefox"
  | "bitwarden"
  | "1password"
  | "lastpass"
  | "csv"
  | "generic-json"
  | "unknown";

export function detectImportFormat(
  content: string,
  fileName: string,
): ImportFormat {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";

  // 1PUX extension takes priority
  if (ext === "1pux") return "1password";

  const trimmed = content.trim();

  // Try JSON detection
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;

      // Bitwarden unencrypted export
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "encrypted" in parsed &&
        (parsed as Record<string, unknown>).encrypted === false &&
        "items" in parsed &&
        Array.isArray((parsed as Record<string, unknown>).items)
      ) {
        return "bitwarden";
      }

      // 1Password 1PUX top-level structure
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        ("accounts" in parsed || "attrs" in parsed)
      ) {
        return "1password";
      }

      // Generic JSON: array of login-like objects
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (first && typeof first === "object") {
          const keys = Object.keys(first).map((k) => k.toLowerCase());
          if (
            keys.some((k) =>
              [
                "login",
                "url",
                "origin",
                "username",
                "password",
                "name",
                "title",
              ].includes(k),
            )
          ) {
            return "generic-json";
          }
        }
      }
    } catch {
      // Not valid JSON – fall through to CSV detection
    }
  }

  // CSV detection by header content
  if (trimmed.includes(",")) {
    const firstLine = trimmed.split(/\r?\n/u)[0]?.toLowerCase() ?? "";

    // Firefox CSV headers (signon_realm, username, password)
    if (firstLine.includes("signon_realm")) {
      return "firefox";
    }

    // LastPass CSV headers (must check before generic CSV)
    if (
      firstLine.includes("grouping") ||
      (firstLine.includes("fav") && firstLine.includes("totp"))
    ) {
      return "lastpass";
    }

    // 1Password-specific CSV header markers
    if (
      firstLine.includes("type") ||
      firstLine.includes("vault") ||
      firstLine.includes("login_uri")
    ) {
      return "1password";
    }

    // Chrome CSV headers (has "note" column distinguishing it from generic)
    if (
      firstLine.includes("name") &&
      firstLine.includes("url") &&
      firstLine.includes("username") &&
      firstLine.includes("password") &&
      firstLine.includes("note")
    ) {
      return "chrome";
    }

    // Generic CSV with known field headers
    if (
      firstLine.includes("url") ||
      firstLine.includes("name") ||
      firstLine.includes("title") ||
      firstLine.includes("username") ||
      firstLine.includes("password") ||
      firstLine.includes("website")
    ) {
      return "csv";
    }

    // Has commas and looks like a header line
    if (firstLine.length > 0) {
      return "csv";
    }
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Column mapping for field-mapping step
// ---------------------------------------------------------------------------

export type ColumnMapping = {
  origin: string;
  username: string;
  password: string;
  title: string;
  notes: string;
};

const DEFAULT_ORIGIN_HEADERS = [
  "url",
  "origin",
  "website",
  "signon_realm",
  "login_uri",
  "web_site",
];
const DEFAULT_USERNAME_HEADERS = [
  "username",
  "login",
  "email",
  "login_username",
];
const DEFAULT_PASSWORD_HEADERS = ["password", "login_password"];
const DEFAULT_TITLE_HEADERS = ["name", "title"];
const DEFAULT_NOTES_HEADERS = ["notes", "note", "extra", "comments"];

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);

  const find = (candidates: string[]): string => {
    for (const candidate of candidates) {
      const idx = normalized.indexOf(candidate);
      if (idx >= 0) return headers[idx]!;
    }
    return "";
  };

  return {
    origin: find(DEFAULT_ORIGIN_HEADERS),
    username: find(DEFAULT_USERNAME_HEADERS),
    password: find(DEFAULT_PASSWORD_HEADERS),
    title: find(DEFAULT_TITLE_HEADERS),
    notes: find(DEFAULT_NOTES_HEADERS),
  };
}

// ---------------------------------------------------------------------------
// CSV parser (with optional custom mapping)
// ---------------------------------------------------------------------------

export function parsePasswordCsv(
  csv: string,
  mapping?: ColumnMapping,
): { rows: ImportLoginRow[]; rejected: number; headers: string[] } {
  const lines = csv
    .replace(/^﻿/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { rows: [], rejected: 0, headers: [] };
  }

  const rawHeaders = splitCsvLine(lines[0] ?? "");
  const headers = rawHeaders.map(normalizeHeader);
  const rows: ImportLoginRow[] = [];
  let rejected = 0;

  // Build column index map from mapping or auto-detect
  const mappingResolved = mapping ?? autoDetectMapping(rawHeaders);
  const headerIndex = (name: string): number => {
    if (!name) return -1;
    return headers.indexOf(normalizeHeader(name));
  };

  const originIdx = headerIndex(mappingResolved.origin);
  const usernameIdx = headerIndex(mappingResolved.username);
  const passwordIdx = headerIndex(mappingResolved.password);
  const titleIdx = headerIndex(mappingResolved.title);
  const notesIdx = headerIndex(mappingResolved.notes);

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);

    const origin = originIdx >= 0 ? (values[originIdx] ?? "") : "";
    const username = usernameIdx >= 0 ? (values[usernameIdx] ?? "") : "";
    const password = passwordIdx >= 0 ? (values[passwordIdx] ?? "") : "";
    const title = titleIdx >= 0 ? (values[titleIdx] ?? "") || undefined : undefined;
    const notes = notesIdx >= 0 ? (values[notesIdx] ?? "") || undefined : undefined;

    const candidate = { origin, username, password, title, notes };
    const parsed = importLoginRowSchema.safeParse(candidate);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      rejected += 1;
    }
  }

  return { rows, rejected, headers: rawHeaders };
}

// ---------------------------------------------------------------------------
// Unified parser entry point
// ---------------------------------------------------------------------------

export function parsePasswordImport(
  content: string,
  format: ImportFormat,
): { rows: ImportLoginRow[]; rejected: number } {
  switch (format) {
    case "chrome":
    case "csv":
    case "lastpass":
      return parsePasswordCsv(content);
    case "firefox":
      return parsePasswordCsv(content, {
        origin: "signon_realm",
        username: "username",
        password: "password",
        title: "",
        notes: "",
      });
    case "bitwarden":
      return parseBitwardenJson(content);
    case "1password":
      return parseOnePassword(content);
    case "generic-json":
      return parseGenericLoginJson(content);
    default:
      return { rows: [], rejected: 0 };
  }
}

// ---------------------------------------------------------------------------
// Bitwarden JSON parser
// ---------------------------------------------------------------------------

interface BitwardenUri {
  uri?: string | null;
}

interface BitwardenLogin {
  username?: string | null;
  password?: string | null;
  uris?: BitwardenUri[];
}

interface BitwardenItem {
  name?: string;
  notes?: string | null;
  login?: BitwardenLogin;
}

interface BitwardenExport {
  encrypted: boolean;
  items?: BitwardenItem[];
}

function parseBitwardenJson(
  content: string,
): { rows: ImportLoginRow[]; rejected: number } {
  let data: BitwardenExport;
  try {
    data = JSON.parse(content.trim()) as BitwardenExport;
  } catch {
    return { rows: [], rejected: 0 };
  }

  const items = data.items ?? [];
  const rows: ImportLoginRow[] = [];
  let rejected = 0;

  for (const item of items) {
    const username = item.login?.username?.trim() ?? "";
    const password = item.login?.password?.trim() ?? "";
    const title = item.name?.trim() || undefined;
    const notes = item.notes?.trim() || undefined;
    const uris = item.login?.uris ?? [];

    if (!password) {
      rejected += 1;
      continue;
    }

    if (uris.length === 0) {
      const candidate = { origin: "", username, password, title, notes };
      const parsed = importLoginRowSchema.safeParse(candidate);
      if (parsed.success) {
        rows.push(parsed.data);
      } else {
        rejected += 1;
      }
    } else {
      for (const uriObj of uris) {
        const origin = uriObj.uri?.trim() ?? "";
        const candidate = { origin, username, password, title, notes };
        const parsed = importLoginRowSchema.safeParse(candidate);
        if (parsed.success) {
          rows.push(parsed.data);
        } else {
          rejected += 1;
        }
      }
    }
  }

  return { rows, rejected };
}

// ---------------------------------------------------------------------------
// 1Password parser
// ---------------------------------------------------------------------------

function parseOnePassword(
  content: string,
): { rows: ImportLoginRow[]; rejected: number } {
  const trimmed = content.trim();

  // 1PUX is a zip archive – cannot be parsed as text
  if (
    !trimmed.includes(",") &&
    !trimmed.startsWith("{") &&
    !trimmed.startsWith("[")
  ) {
    return { rows: [], rejected: 0 };
  }

  // Treat as 1Password CSV
  return parsePasswordCsv(trimmed);
}

// ---------------------------------------------------------------------------
// Generic JSON array parser
// ---------------------------------------------------------------------------

interface GenericLoginJson {
  name?: string;
  title?: string;
  url?: string;
  origin?: string;
  website?: string;
  username?: string;
  password?: string;
  notes?: string;
}

function parseGenericLoginJson(
  content: string,
): { rows: ImportLoginRow[]; rejected: number } {
  let data: unknown;
  try {
    data = JSON.parse(content.trim());
  } catch {
    return { rows: [], rejected: 0 };
  }

  if (!Array.isArray(data)) {
    return { rows: [], rejected: 0 };
  }

  const arr = data as GenericLoginJson[];
  const rows: ImportLoginRow[] = [];
  let rejected = 0;

  for (const entry of arr) {
    if (!entry || typeof entry !== "object") {
      rejected += 1;
      continue;
    }

    const password = entry.password?.trim() ?? "";
    if (!password) {
      rejected += 1;
      continue;
    }

    const origin =
      entry.url?.trim() ||
      entry.origin?.trim() ||
      entry.website?.trim() ||
      "";
    const username = entry.username?.trim() ?? "";
    const title = entry.name?.trim() || entry.title?.trim() || undefined;
    const notes = entry.notes?.trim() || undefined;

    const candidate = { origin, username, password, title, notes };
    const parsed = importLoginRowSchema.safeParse(candidate);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      rejected += 1;
    }
  }

  return { rows, rejected };
}
