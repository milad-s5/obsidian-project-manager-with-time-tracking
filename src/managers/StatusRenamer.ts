import { App } from "obsidian";
import { ProjectManagerSettings, Workspace } from "../types";
import { normalizeStatus } from "../utils/StatusColors";
import { isUnderAnyFolder, projectFolders, taskFolders } from "../utils/WorkspacePaths";

/**
 * Statuses with a meaning beyond their name: the backlog column, what Focus
 * mode and the timer call active, and what progress counts as done.
 * Renaming them would quietly switch those features off.
 */
export const FIXED_STATUSES = ["backlog", "active", "done"];

/**
 * Renames a status in every task and project note of every workspace,
 * archived ones included. Renaming into a status that already exists
 * merges the two.
 *
 * @returns how many notes were changed
 */
export async function renameStatusInNotes(
  app: App,
  workspaces: Workspace[],
  from: string,
  to: string
): Promise<number> {
  const folders = workspaces.flatMap((ws) => [...taskFolders(ws), ...projectFolders(ws)]);
  let count = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    if (!isUnderAnyFolder(file.path, folders)) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "task" && fm?.type !== "project") continue;
    if (normalizeStatus(fm.status) !== from) continue;
    await app.fileManager.processFrontMatter(file, (data) => {
      data.status = to;
    });
    count++;
  }
  return count;
}

/** The same rename in settings: the status list, closed statuses, folded columns */
export function renameStatusInSettings(settings: ProjectManagerSettings, from: string, to: string): void {
  const swap = (list: string[]) => [...new Set(list.map((s) => (s === from ? to : s)))];
  settings.statuses = swap(settings.statuses);
  settings.closedStatuses = swap(settings.closedStatuses);
  for (const key of Object.keys(settings.collapsedColumns)) {
    const [board, status] = key.split(":");
    if (status !== from) continue;
    settings.collapsedColumns[`${board}:${to}`] = settings.collapsedColumns[key];
    delete settings.collapsedColumns[key];
  }
}
