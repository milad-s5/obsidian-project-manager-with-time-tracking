import { App, TFile, normalizePath } from "obsidian";
import { Workspace } from "../types";
import { linkSlug, slugify } from "../utils/FrontmatterUtils";
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
    const slug = slugify(title);
    const path = normalizePath(`${ws.projectsFolder}/${slug}.md`);

    const frontmatter = `---
type: project
title: "${title}"
status: "${status}"
priority: "${priority}"
start: ""
end: ""
created: "${todayString()}"
due: "${due}"
tags: [project]
hours: 0
task_count: 0
workspace: "[[${ws.name}]]"
---

# ${title}

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

  async updateProjectStats(app: App, ws: Workspace, projectSlug: string): Promise<void> {
    // The project may be archived, so a fixed path will not find it
    const projectFile = (await this.getProjects(ws)).find((f) => f.basename === projectSlug);
    if (!projectFile) return;

    // Archived tasks have to count too, or a project's hours and task count drop
    // to zero the moment it closes
    const taskFolderList = taskFolders(ws);
    const tasks = app.vault.getMarkdownFiles().filter((f) => {
      if (!isUnderAnyFolder(f.path, taskFolderList)) return false;
      const cache = app.metadataCache.getFileCache(f);
      const fm = cache?.frontmatter;
      return fm?.type === "task" && linkSlug(fm?.project) === projectSlug;
    });

    let totalHours = 0;
    for (const t of tasks) {
      const fm = app.metadataCache.getFileCache(t)?.frontmatter;
      totalHours += Number(fm?.total_hours ?? 0);
    }

    await app.fileManager.processFrontMatter(projectFile, (fm) => {
      fm.task_count = tasks.length;
      fm.hours = Math.round(totalHours * 100) / 100;
    });
  }
}
