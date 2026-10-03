export function collectExistingFolders(
  items: readonly { folder: string }[],
): string[] {
  const folders: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const folder = item.folder.trim();
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    folders.push(folder);
  }

  return folders;
}
