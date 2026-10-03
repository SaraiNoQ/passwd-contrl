export interface FolderItem {
  folder: string;
}

export interface VaultFolderSection<T extends FolderItem> {
  key: string;
  folder: string;
  isUncategorized: boolean;
  data: T[];
}

/**
 * Builds SectionList-ready folders without changing the order of items inside
 * each folder. Whitespace-only folder names share the final uncategorized
 * section.
 */
export function groupVaultItemsByFolder<T extends FolderItem>(
  items: readonly T[],
  locale: string,
): VaultFolderSection<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const folder = item.folder.trim();
    const group = groups.get(folder);
    if (group) {
      group.push(item);
    } else {
      groups.set(folder, [item]);
    }
  }

  const namedFolders = [...groups.keys()]
    .filter((folder) => folder.length > 0)
    .sort((left, right) => left.localeCompare(right, locale, {
      numeric: true,
      sensitivity: "base",
    }));

  if (groups.has("")) namedFolders.push("");

  return namedFolders.map((folder) => ({
    key: folder.length > 0 ? `folder:${folder}` : "folder:uncategorized",
    folder,
    isUncategorized: folder.length === 0,
    data: groups.get(folder) ?? [],
  }));
}
