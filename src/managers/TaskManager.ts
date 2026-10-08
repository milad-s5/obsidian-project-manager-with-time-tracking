import { App, TFile } from "obsidian";
import { Workspace } from "../types";
import { DONE_STATUS, normalizeStatus } from "../utils/StatusColors";
import { linkSlug, slugify, yamlString } from "../utils/FrontmatterUtils";
import { todayString } from "../utils/DateUtils";
import { toISODate } from "../utils/Jalali";
import { isUnderAnyFolder, taskFolders } from "../utils/WorkspacePaths";
import { uniqueNotePath } from "../utils/FileOps";

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
    // Two different tasks can share a title, especially when imported in bulk
    // or when a recurring chore comes back after the last one was archived
    const path = uniqueNotePath(this.app, ws.tasksFolder, slugify(title) || "task");

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
end: ${normalizeStatus(status) === DONE_STATUS ? `"${todayString()}"` : '""'}
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
    // The day the work counts for: the one it started on, which is also the
    // day the dashboard files it under. This used to be today, so an entry
    // added for last Monday was logged, and counted in days_count, as today.
    const dateStr = toISODate(startTime);
    const startStr = startTime.toISOString();
    const endStr = endTime.toISOString();

    // Added to whatever the note holds at the moment of writing. Reading it
    // from the metadata cache first, as this used to, could see a value from
    // before the previous write had been parsed, and that write was lost.
    await app.fileManager.processFrontMatter(file, (fmatter) => {
      const current = Number(fmatter.total_hours ?? 0) || 0;
      fmatter.total_hours = Math.round((current + newHours) * 100) / 100;
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
