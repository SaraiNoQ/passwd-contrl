import type { ImportLoginRow } from "@zero-vault/shared";
import { importLoginRowSchema } from "@zero-vault/shared";

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

const normalizeHeader = (header: string) => header.trim().toLowerCase().replaceAll(" ", "_");

const pick = (row: Record<string, string>, names: string[]) => {
  for (const name of names) {
    const value = row[name];
    if (value) {
      return value;
    }
  }
  return "";
};

export const parsePasswordCsv = (csv: string): { rows: ImportLoginRow[]; rejected: number } => {
  const lines = csv
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], rejected: 0 };
  }

  const headers = splitCsvLine(lines[0] ?? "").map(normalizeHeader);
  const rows: ImportLoginRow[] = [];
  let rejected = 0;

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const candidate = {
      origin: pick(raw, ["url", "origin", "website", "signon_realm"]),
      username: pick(raw, ["username", "login", "email"]),
      password: pick(raw, ["password"]),
      title: pick(raw, ["name", "title"]) || undefined,
      notes: pick(raw, ["notes", "note"]) || undefined
    };
    const parsed = importLoginRowSchema.safeParse(candidate);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      rejected += 1;
    }
  }

  return { rows, rejected };
};
