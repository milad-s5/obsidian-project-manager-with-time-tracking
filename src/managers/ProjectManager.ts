import { App, TFile } from "obsidian";
import { Workspace } from "../types";
import { linkSlug, slugify, yamlString } from "../utils/FrontmatterUtils";
import { uniqueNotePath } from "../utils/FileOps";
import { normalizeStatus } from "../utils/StatusColors";
import { isDoneStatus, isOpenStatus } from "./AnalyticsManager";
import { todayString } from "../utils/DateUtils";
import { isUnderAnyFolder, projectFolders, taskFolders } from "../utils/WorkspacePaths";

export class ProjectManager {
  constructor(private app: App) {}

  async createProject(
    ws: Workspace,
    title: string,
    status: string,
    priority: string,
    due: string
  ): Promise<TFile> {
    // Same treatment tasks already had: a quote in the title no longer breaks
    // the frontmatter (which hid the project from every board), a second
    // project of the same name no longer fails to save, and a title with no
    // usable letters still gets a file name
    const path = uniqueNotePath(this.app, ws.projectsFolder, slugify(title) || "project");

    const frontmatter = `---
type: project
title: ${yamlString(title.trim())}
status: ${yamlString(status)}
priority: ${yamlString(priority)}
start: ""
end: ""
created: "${todayString()}"
due: ${yamlString(due)}
tags: [project]
hours: 0
task_count: 0
workspace: "[[${ws.name}]]"
---

# ${title.trim()}

`;

    const file = await this.app.vault.create(path, frontmatter);
    return file;
  }

  /** Includes archived projects */
  async getProjects(ws: Workspace): Promise<TFile[]> {
    const files = this.app.vault.getMarkdownFiles();
    const folders = projectFolders(ws);
    const result: TFile[] = [];
    for (const file of files) {
      if (!isUnderAnyFolder(file.path, folders)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.type === "project" && linkSlug(cache?.frontmatter?.workspace) === ws.name) {
        result.push(file);
      }
    }
    return result;
  }

  /**
   * Recounts a project's hours and task_count from its tasks.
   *
   * task_count counts what the board's "done of" counts: tasks that are done
   * or still open. Cancelled and abandoned tasks are left out, and so is the
   * backlog, which has not been taken on. Hours include every task.
   *
   * @returns whether the note had to be changed
   */
  async updateProjectStats(app: App, ws: Workspace, projectSlug: string): Promise<boolean> {
    // The project may be archived, so a fixed path will not find it
    const projectFile = (await this.getProjects(ws)).find((f) => f.basename === projectSlug);
    if (!projectFile) return false;

    // Archived tasks have to count too, or a project's hours and task count drop
    // to zero the moment it closes
    const taskFolderList = taskFolders(ws);
    const tasks = app.vault.getMarkdownFiles()
      .filter((f) => isUnderAnyFolder(f.path, taskFolderList))
      .map((f) => app.metadataCache.getFileCache(f)?.frontmatter)
      .filter((fm) => fm?.type === "task" && linkSlug(fm?.project) === projectSlug);

    const counted = tasks.filter((fm) => {
      const status = normalizeStatus(fm?.status);
      return isDoneStatus(status) || isOpenStatus(status);
    }).length;
    const hours = Math.round(tasks.reduce((sum, fm) => sum + (Number(fm?.total_hours ?? 0) || 0), 0) * 100) / 100;

    // Unchanged numbers are not rewritten, so recounting is cheap and quiet
    const current = app.metadataCache.getFileCache(projectFile)?.frontmatter;
    if (Number(current?.task_count) === counted && Number(current?.hours) === hours) return false;
    await app.fileManager.processFrontMatter(projectFile, (fm) => {
      fm.task_count = counted;
      fm.hours = hours;
    });
    return true;
  }

}
