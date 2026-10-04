import { App, normalizePath } from "obsidian";
import { Workspace } from "../types";

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
}
