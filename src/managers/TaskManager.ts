import { App, TFile, normalizePath } from "obsidian";
import { Workspace, TaskFrontmatter } from "../types";
import { linkSlug, slugify, yamlString } from "../utils/FrontmatterUtils";
import { todayString } from "../utils/DateUtils";
import { isUnderAnyFolder, taskFolders } from "../utils/WorkspacePaths";

export class TaskManager {
  constructor(private app: App) {}

  /**
   * @param extra additional frontmatter fields — an external source id, say, so
   *              that importers can tell this task has already been created
   */
  async createTask(
    ws: Workspace,
    title: string,
    projectSlug: string,
    status: string,
    priority: string,
    due: string,
    extra?: Record<string, string | number>
  ): Promise<TFile> {
    const path = await this.uniqueTaskPath(ws, slugify(title));

    const extraLines = Object.entries(extra ?? {})
      .map(([k, v]) => `${k}: ${typeof v === "number" ? v : yamlString(String(v))}\n`)
      .join("");

    const frontmatter = `---
type: task
title: ${yamlString(title)}
project: ${projectSlug ? `"[[${projectSlug}]]"` : '""'}
status: ${yamlString(status)}
priority: ${yamlString(priority)}
start: ""
end: ""
created: "${todayString()}"
due: ${yamlString(due)}
total_hours: 0
days_count: 0
workspace: "[[${ws.name}]]"
${extraLines}---

# ${title}

## Time Log

| Date | Hours | Start | End |
|------|-------|-------|-----|
`;

    const file = await this.app.vault.create(path, frontmatter);
    return file;
  }

  /**
   * Two different tasks can share a title, especially when imported in bulk.
   * vault.create used to throw in that case.
   */
  private async uniqueTaskPath(ws: Workspace, slug: string): Promise<string> {
    const base = slug || "task";
    let path = normalizePath(`${ws.tasksFolder}/${base}.md`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${ws.tasksFolder}/${base}-${n}.md`);
      n++;
    }
    return path;
  }

  /** Includes archived tasks — otherwise the done column comes up empty */
  async getTasks(ws: Workspace): Promise<TFile[]> {
    const files = this.app.vault.getMarkdownFiles();
    const folders = taskFolders(ws);
    const result: TFile[] = [];
    for (const file of files) {
      if (!isUnderAnyFolder(file.path, folders)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.type === "task" && linkSlug(cache?.frontmatter?.workspace) === ws.name) {
        result.push(file);
      }
    }
    return result;
  }

  async updateTaskHours(app: App, file: TFile, newHours: number, startTime: Date, endTime: Date): Promise<void> {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const currentHours = Number(fm.total_hours ?? 0);
    const updatedHours = Math.round((currentHours + newHours) * 100) / 100;

    // Parse existing days
    const existingDays = new Set<string>();
    const dateStr = todayString();
    const startStr = startTime.toISOString();
    const endStr = endTime.toISOString();

    await app.fileManager.processFrontMatter(file, (fmatter) => {
      fmatter.total_hours = updatedHours;
    });

    // Append row to time log table in content
    await app.vault.process(file, (content) => {
      const row = `| ${dateStr} | ${newHours} | ${startStr} | ${endStr} |`;
      if (content.includes("| Date | Hours | Start | End |")) {
        return content + row + "\n";
      }
      return content + `\n## Time Log\n\n| Date | Hours | Start | End |\n|------|-------|-------|-----|\n${row}\n`;
    });

    // Recount days
    await this.recalculateDaysCount(app, file);
  }

  async recalculateDaysCount(app: App, file: TFile): Promise<void> {
    const content = await app.vault.read(file);
    const lines = content.split("\n");
    const days = new Set<string>();
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith("| Date")) { inTable = true; continue; }
      if (inTable && line.startsWith("|---")) continue;
      if (inTable && line.startsWith("|")) {
        const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
        if (parts[0] && parts[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
          days.add(parts[0]);
        }
      } else if (inTable) {
        inTable = false;
      }
    }
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.days_count = days.size;
    });
  }
}
