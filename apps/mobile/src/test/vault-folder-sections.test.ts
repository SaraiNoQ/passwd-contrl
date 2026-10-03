import { describe, expect, it } from "vitest";
import { groupVaultItemsByFolder } from "../screens/vault-folder-sections";

describe("groupVaultItemsByFolder", () => {
  it("trims and merges folder names while preserving item order", () => {
    const sections = groupVaultItemsByFolder([
      { id: "one", folder: " Work " },
      { id: "two", folder: "Personal" },
      { id: "three", folder: "Work" },
    ], "en-US");

    expect(sections.map((section) => section.folder)).toEqual(["Personal", "Work"]);
    expect(sections[1]?.data.map((item) => item.id)).toEqual(["one", "three"]);
  });

  it("sorts named folders and keeps whitespace-only items in the final section", () => {
    const sections = groupVaultItemsByFolder([
      { id: "z", folder: "Zulu" },
      { id: "blank", folder: "   " },
      { id: "a", folder: "Alpha" },
      { id: "empty", folder: "" },
    ], "en-US");

    expect(sections.map((section) => ({
      folder: section.folder,
      uncategorized: section.isUncategorized,
    }))).toEqual([
      { folder: "Alpha", uncategorized: false },
      { folder: "Zulu", uncategorized: false },
      { folder: "", uncategorized: true },
    ]);
    expect(sections[2]?.data.map((item) => item.id)).toEqual(["blank", "empty"]);
  });

  it("only creates sections represented by the supplied filtered items", () => {
    const sections = groupVaultItemsByFolder([
      { id: "match", folder: "Only result" },
    ], "en-US");

    expect(sections).toHaveLength(1);
    expect(sections[0]?.data).toEqual([{ id: "match", folder: "Only result" }]);
  });
});
