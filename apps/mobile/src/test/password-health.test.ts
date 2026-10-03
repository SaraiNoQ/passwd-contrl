import { describe, expect, it } from "vitest";
import type { VaultItem } from "@zero-vault/shared";
import { analyzePasswordHealth } from "../lib/password-health";
import { CREATED_AT, ITEM_ID_A, ITEM_ID_B, UPDATED_AT } from "./fixtures";

function login(id: string, password: string): VaultItem {
  return {
    id,
    type: "login",
    title: id,
    folder: "",
    notes: "",
    customFields: [],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    origin: "https://example.com",
    username: "user",
    password,
  };
}

describe("analyzePasswordHealth", () => {
  it("reports missing, weak and reused passwords without returning password material", () => {
    const strongReused = "Unique!Pass123";
    const report = analyzePasswordHealth([
      login(ITEM_ID_A, strongReused),
      login(ITEM_ID_B, strongReused),
      login("77777777-7777-4777-8777-777777777777", "weak"),
      login("88888888-8888-4888-8888-888888888888", ""),
      {
        id: "99999999-9999-4999-8999-999999999999",
        type: "secure_note",
        title: "note",
        folder: "",
        notes: "",
        customFields: [],
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        noteBody: "note",
      },
    ]);

    expect(report).toMatchObject({ loginCount: 4, missingCount: 1, weakCount: 1, reusedCount: 2 });
    expect(report.risks).toEqual([
      { itemId: ITEM_ID_A, reasons: ["reused"] },
      { itemId: ITEM_ID_B, reasons: ["reused"] },
      { itemId: "77777777-7777-4777-8777-777777777777", reasons: ["weak"] },
      { itemId: "88888888-8888-4888-8888-888888888888", reasons: ["missing"] },
    ]);
    expect(JSON.stringify(report)).not.toContain(strongReused);
  });
});
