import { useMemo } from "react";
import type { VaultItem } from "@zero-vault/shared";

export function useFolders(items: VaultItem[]) {
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.folder && item.folder.trim()) {
        set.add(item.folder.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [items]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const folder = item.folder?.trim() || "";
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const uncategorizedCount = folderCounts.get("") ?? 0;

  return { folders, folderCounts, uncategorizedCount };
}
