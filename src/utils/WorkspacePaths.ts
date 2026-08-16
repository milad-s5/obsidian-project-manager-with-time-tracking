import { App, normalizePath } from "obsidian";
import { Workspace } from "../types";
import { linkSlug } from "./FrontmatterUtils";

/**
 * A workspace's folders exist in two versions, active and archived. Anywhere that
 * collects files has to look at *both*, or the moment a task is archived its
 * hours vanish from the reports and the calendar.
 */

export function archiveEnabled(ws: Workspace): boolean {
  return !!ws.archiveFolder && ws.archiveFolder.trim().length > 0;
}

export function archiveTasksFolder(ws: Workspace): string {
  return normalizePath(`${ws.archiveFolder}/Tasks`);
}

export function archiveProjectsFolder(ws: Workspace): string {
  return normalizePath(`${ws.archiveFolder}/Projects`);
}

export function archiveTimeEntriesFolder(ws: Workspace): string {
  return normalizePath(`${ws.archiveFolder}/TimeEntries`);
}

/** Task folders: [active, archived] — or just active when archiving is off */
export function taskFolders(ws: Workspace): string[] {
  return archiveEnabled(ws)
    ? [normalizePath(ws.tasksFolder), archiveTasksFolder(ws)]
    : [normalizePath(ws.tasksFolder)];
}

export function projectFolders(ws: Workspace): string[] {
  return archiveEnabled(ws)
    ? [normalizePath(ws.projectsFolder), archiveProjectsFolder(ws)]
    : [normalizePath(ws.projectsFolder)];
}

export function timeEntryFolders(ws: Workspace): string[] {
  return archiveEnabled(ws)
    ? [normalizePath(ws.timeEntriesFolder), archiveTimeEntriesFolder(ws)]
    : [normalizePath(ws.timeEntriesFolder)];
}

/** Is this path under any of these folders? */
export function isUnderAnyFolder(path: string, folders: string[]): boolean {
  return folders.some((f) => f && path.startsWith(`${f}/`));
}

export function isArchivedPath(ws: Workspace, path: string): boolean {
  if (!archiveEnabled(ws)) return false;
  return path.startsWith(`${normalizePath(ws.archiveFolder)}/`);
}

/** Default archive path for workspaces that have not set one */
export function defaultArchiveFolder(rootFolder: string): string {
  return `${rootFolder}/Archive`;
}

/**
 * Every project in a workspace as {slug, title} — synchronous, so it can back
 * a filter's <datalist> at toolbar-render time, before the async analytics
 * collect has run. Includes archived projects, same as everywhere else that
 * lists projects.
 */
export function listProjectOptions(app: App, ws: Workspace): { slug: string; title: string }[] {
  const folders = projectFolders(ws);
  const out: { slug: string; title: string }[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!isUnderAnyFolder(file.path, folders)) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "project" || linkSlug(fm.workspace) !== ws.name) continue;
    out.push({ slug: file.basename, title: String(fm.title ?? file.basename) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
