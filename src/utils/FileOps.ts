import { App, TFile } from "obsidian";
import { DeleteBehaviour } from "../types";

/**
 * Removes a note the way the vault owner asked for.
 *
 * Obsidian already has a per-vault preference for deleted files, and trashFile
 * honours it — so "trash" is not a second opinion, it is deferring to theirs.
 * "permanent" is the opt-out for people who never want the file back.
 */
export async function deleteNote(
  app: App,
  file: TFile,
  behaviour: DeleteBehaviour
): Promise<void> {
  if (behaviour === "permanent") await app.vault.delete(file);
  else await app.fileManager.trashFile(file);
}

/** What the confirmation dialog should warn about, given the setting */
export function deleteWarning(behaviour: DeleteBehaviour): string {
  return behaviour === "permanent"
    ? "will be deleted for good — this cannot be undone"
    : "will be moved to the trash";
}
