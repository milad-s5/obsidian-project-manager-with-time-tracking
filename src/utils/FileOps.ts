import { App, TFile, normalizePath } from "obsidian";
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

/**
 * A path in this folder whose note name no other note in the vault has.
 *
 * Tasks, projects and time entries all find each other through [[name]]
 * links, which Obsidian resolves by name across the whole vault, ignoring
 * case. Two notes of the same name, one archived and one not, made those
 * links ambiguous, and the reports then put one task's hours on the other.
 */
export function uniqueNotePath(app: App, folder: string, slug: string): string {
  const taken = new Set(app.vault.getMarkdownFiles().map((f) => f.basename.toLowerCase()));
  let name = slug;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${slug}-${n}`;
  return normalizePath(`${folder}/${name}.md`);
}
