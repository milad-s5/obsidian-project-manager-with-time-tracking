import { App, TFile, normalizePath } from "obsidian";
import { Workspace } from "../types";
import { isClosedStatus } from "../utils/StatusColors";
import { linkSlug } from "../utils/FrontmatterUtils";
import { WorkspaceManager } from "./WorkspaceManager";
import {
  archiveEnabled, archiveProjectsFolder, archiveTasksFolder, archiveTimeEntriesFolder,
  isArchivedPath, projectFolders, taskFolders, timeEntryFolders,
} from "../utils/WorkspacePaths";

/** Closed statuses, from settings, are the ones that get archived */
export function isArchivableStatus(status: unknown): boolean {
  return isClosedStatus(status);
}

export interface ArchiveResult {
  moved: number;
  restored: number;
}

export class ArchiveManager {
  constructor(private app: App, private workspaceManager: WorkspaceManager) {}

  // ── Syncing one task ────────────────────────────────────────────────

  /**
   * Moves a task to wherever its status says it belongs, taking its time entries
   * along. Restoring is the same trip: set the status back to todo or active.
   */
  async syncTask(ws: Workspace, file: TFile): Promise<ArchiveResult> {
    if (!archiveEnabled(ws)) return { moved: 0, restored: 0 };

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "task") return { moved: 0, restored: 0 };

    const shouldArchive = isArchivableStatus(fm.status);
    const isArchived = isArchivedPath(ws, file.path);
    if (shouldArchive === isArchived) return { moved: 0, restored: 0 };

    const slug = file.basename;
    const target = shouldArchive ? archiveTasksFolder(ws) : normalizePath(ws.tasksFolder);
    await this.moveFile(file, target);
    const entries = await this.moveTimeEntriesFor(ws, slug, shouldArchive);

    return shouldArchive
      ? { moved: 1 + entries, restored: 0 }
      : { moved: 0, restored: 1 + entries };
  }

  // ── Syncing a project, which cascades ───────────────────────────────

  /**
   * When a project closes its tasks and their time entries go too, so nothing
   * has to be chased down by hand.
   *
   * Restoring only brings back tasks that are themselves open. A task that is
   * done in its own right stays archived, because its archiving was never the
   * project's doing.
   */
  async syncProject(ws: Workspace, file: TFile): Promise<ArchiveResult> {
    if (!archiveEnabled(ws)) return { moved: 0, restored: 0 };

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "project") return { moved: 0, restored: 0 };

    const shouldArchive = isArchivableStatus(fm.status);
    const slug = file.basename;
    const result: ArchiveResult = { moved: 0, restored: 0 };

    // 1) the project itself
    if (shouldArchive !== isArchivedPath(ws, file.path)) {
      const target = shouldArchive ? archiveProjectsFolder(ws) : normalizePath(ws.projectsFolder);
      await this.moveFile(file, target);
      if (shouldArchive) result.moved++;
      else result.restored++;
    }

    // 2) the tasks belonging to it
    for (const task of this.tasksOfProject(ws, slug)) {
      const taskFm = this.app.metadataCache.getFileCache(task)?.frontmatter;
      // Only open tasks come back
      const taskShouldArchive = shouldArchive || isArchivableStatus(taskFm?.status);
      if (taskShouldArchive === isArchivedPath(ws, task.path)) continue;

      const target = taskShouldArchive ? archiveTasksFolder(ws) : normalizePath(ws.tasksFolder);
      const taskSlug = task.basename;
      await this.moveFile(task, target);
      const entries = await this.moveTimeEntriesFor(ws, taskSlug, taskShouldArchive);
      if (taskShouldArchive) result.moved += 1 + entries;
      else result.restored += 1 + entries;
    }

    return result;
  }

  // ── Bulk operations ─────────────────────────────────────────────────

  /**
   * Tidies a whole workspace: everything closed goes to the archive, everything
   * reopened comes back. For items that closed before archiving existed.
   */
  async syncWorkspace(ws: Workspace): Promise<ArchiveResult> {
    if (!archiveEnabled(ws)) return { moved: 0, restored: 0 };
    await this.ensureArchiveFolders(ws);

    const total: ArchiveResult = { moved: 0, restored: 0 };

    // Projects first, since their cascade moves tasks as well
    for (const file of this.filesIn(projectFolders(ws), "project", ws)) {
      const r = await this.syncProject(ws, file);
      total.moved += r.moved;
      total.restored += r.restored;
    }

    // Then whatever tasks are left, with no project or an open one
    for (const file of this.filesIn(taskFolders(ws), "task", ws)) {
      const r = await this.syncTask(ws, file);
      total.moved += r.moved;
      total.restored += r.restored;
    }

    return total;
  }

  async ensureArchiveFolders(ws: Workspace): Promise<void> {
    if (!archiveEnabled(ws)) return;
    await this.workspaceManager.ensureFolder(ws.archiveFolder);
    await this.workspaceManager.ensureFolder(archiveTasksFolder(ws));
    await this.workspaceManager.ensureFolder(archiveProjectsFolder(ws));
    await this.workspaceManager.ensureFolder(archiveTimeEntriesFolder(ws));
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private filesIn(folders: string[], type: string, ws: Workspace): TFile[] {
    const out: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!folders.some((f) => file.path.startsWith(`${f}/`))) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type !== type) continue;
      const wsName = linkSlug(fm.workspace);
      if (wsName && wsName !== ws.name) continue;
      out.push(file);
    }
    return out;
  }

  private tasksOfProject(ws: Workspace, projectSlug: string): TFile[] {
    return this.filesIn(taskFolders(ws), "task", ws).filter((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      return linkSlug(fm?.project) === projectSlug;
    });
  }

  /** Moves a task's time entries into the archive, or back out */
  private async moveTimeEntriesFor(
    ws: Workspace,
    taskSlug: string,
    toArchive: boolean
  ): Promise<number> {
    const target = toArchive
      ? archiveTimeEntriesFolder(ws)
      : normalizePath(ws.timeEntriesFolder);
    const folders = timeEntryFolders(ws);
    let count = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!folders.some((f) => file.path.startsWith(`${f}/`))) continue;
      if (isArchivedPath(ws, file.path) === toArchive) continue;

      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (linkSlug(fm?.task) !== taskSlug) continue;

      await this.moveFile(file, target);
      count++;
    }
    return count;
  }

  /**
   * Moves go through fileManager.renameFile rather than vault.rename, because
   * that also updates [[...]] links in every other note.
   */
  private async moveFile(file: TFile, targetFolder: string): Promise<void> {
    await this.workspaceManager.ensureFolder(targetFolder);
    let path = normalizePath(`${targetFolder}/${file.name}`);
    if (path === file.path) return;

    let n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${targetFolder}/${file.basename} ${n}.${file.extension}`);
      n++;
    }
    await this.app.fileManager.renameFile(file, path);
  }
}
