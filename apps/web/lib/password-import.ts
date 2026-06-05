import type { ImportLoginRow } from "@zero-vault/shared";
import { importLoginRowSchema } from "@zero-vault/shared";
import { parsePasswordCsv } from "./csv-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportFormat =
  | "bitwarden"
  | "1password"
  | "csv"
  | "generic-json"
  | "unknown";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

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
      const parsed = JSON.parse(trimmed);

      // Bitwarden unencrypted export
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        parsed.encrypted === false &&
        Array.isArray(parsed.items)
      ) {
        const items = parsed.items;
        if (items.length > 0) {
          const first = items[0];
          if (first && typeof first === "object" && "login" in first) {
            return "bitwarden";
          }
        }
        return "bitwarden";
      }

      // 1Password 1PUX top-level structure
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed.accounts !== undefined || parsed.attrs !== undefined)
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

  // CSV detection
  if (trimmed.includes(",")) {
    const firstLine = trimmed.split(/\r?\n/u)[0]?.toLowerCase() ?? "";

    // 1Password-specific CSV header markers
    if (
      firstLine.includes("type") ||
      firstLine.includes("vault") ||
      firstLine.includes("login_uri")
    ) {
      return "1password";
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
// Unified parser entry point
// ---------------------------------------------------------------------------

export function parsePasswordImport(
  content: string,
  format: ImportFormat,
): { rows: ImportLoginRow[]; rejected: number } {
  switch (format) {
    case "bitwarden":
      return parseBitwardenJson(content);
    case "1password":
      return parseOnePassword(content);
    case "generic-json":
      return parseGenericLoginJson(content);
    case "csv":
      return parsePasswordCsv(content);
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

    // Skip items with empty passwords
    if (!password) {
      rejected += 1;
      continue;
    }

    if (uris.length === 0) {
      // No URIs – create one entry with empty origin
      const candidate = { origin: "", username, password, title, notes };
      const parsed = importLoginRowSchema.safeParse(candidate);
      if (parsed.success) {
        rows.push(parsed.data);
      } else {
        rejected += 1;
      }
    } else {
      // Create one entry per URI
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

  // 1PUX is a zip archive – the file.text() call in the browser will produce
  // garbled binary data that looks nothing like CSV.  Return empty rather
  // than trying to parse it.  Users should export as CSV from 1Password.
  if (!trimmed.includes(",") && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { rows: [], rejected: 0 };
  }

  // Treat as 1Password CSV – the existing CSV parser already handles
  // flexible header matching (url/website, username/login/email, etc.)
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
