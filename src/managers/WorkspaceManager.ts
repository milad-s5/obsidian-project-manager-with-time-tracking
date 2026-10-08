import { App, normalizePath } from "obsidian";
import { Workspace } from "../types";
import { linkSlug } from "../utils/FrontmatterUtils";
import { isUnderAnyFolder, projectFolders, taskFolders } from "../utils/WorkspacePaths";

export class WorkspaceManager {
  constructor(private app: App) {}

  async ensureWorkspace(ws: Workspace): Promise<void> {
    await this.ensureFolder(ws.rootFolder);
    await this.ensureFolder(ws.projectsFolder);
    await this.ensureFolder(ws.tasksFolder);
    await this.ensureFolder(ws.timeEntriesFolder);
  }

  async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized) return;
    
    const parts = normalized.split("/").filter(Boolean);

    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        try {
          await this.app.vault.createFolder(current);
        } catch (err) {
          // Folder might already exist due to race condition, ignore
        }
      }
    }
  }

  /**
   * Renames a workspace and every note that names it.
   *
   * Tasks and projects say which workspace they belong to with a
   * "[[Name]]" link, and that name is what every board matches on. Renaming
   * only the setting left all of them behind: the board went empty.
   *
   * @returns how many notes were updated
   */
  async renameWorkspace(ws: Workspace, newName: string): Promise<number> {
    const oldName = ws.name;
    ws.name = newName;
    if (oldName === newName) return 0;
    const folders = [...taskFolders(ws), ...projectFolders(ws)];
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!isUnderAnyFolder(file.path, folders)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (linkSlug(fm?.workspace) !== oldName) continue;
      await this.app.fileManager.processFrontMatter(file, (data) => {
        data.workspace = `[[${newName}]]`;
      });
      count++;
    }
    return count;
  }
}
