import { describe, expect, it } from "vitest";
import { collectExistingFolders } from "../lib/folder-suggestions";

describe("collectExistingFolders", () => {
  it("trims names, removes blanks and de-duplicates while preserving first use order", () => {
    expect(collectExistingFolders([
      { folder: " 工作 " },
      { folder: "" },
      { folder: "工作" },
      { folder: "个人" },
      { folder: "   " },
    ])).toEqual(["工作", "个人"]);
  });

  it("does not merge differently cased folder names", () => {
    expect(collectExistingFolders([
      { folder: "Work" },
      { folder: "work" },
    ])).toEqual(["Work", "work"]);
  });
});
