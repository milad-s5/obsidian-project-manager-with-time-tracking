import { App, parseYaml, TFile } from "obsidian";
import { DeleteBehaviour, Workspace } from "../types";
import { linkSlug } from "../utils/FrontmatterUtils";
import { toISOFileStamp } from "../utils/DateUtils";
import { toISODate } from "../utils/Jalali";
import { deleteNote } from "../utils/FileOps";
import { isUnderAnyFolder, timeEntryFolders } from "../utils/WorkspacePaths";

/**
 * One piece of logged time on a task, wherever it is recorded.
 *
 * A session lives in up to three places: a time entry note, a row in the
 * task's Time Log table, and the task's running total_hours and days_count
 * (a project's hours are summed from its tasks). Editing or deleting just
 * one of them by hand left the others disagreeing. Everything here changes
 * all of them together.
 */
export interface LoggedTime {
  /** Identity: start and end as written, or the row text for an old row with no times */
  key: string;
  hours: number;
  /** The local day the time counts for */
  iso: string;
  start: Date | null;
  end: Date | null;
  /** The time entry note, if this session has one */
  entryFile: TFile | null;
  /** The exact Time Log line, if this session has one */
  row: string | null;
}

const ROW_HEADER = "| Date | Hours | Start | End |";

function parseRow(line: string): { date: string; hours: number; start: string; end: string } | null {
  if (!line.startsWith("|")) return null;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) return null;
  const hours = Number(cells[1]);
  if (!Number.isFinite(hours)) return null;
  return { date: cells[0], hours, start: cells[2] ?? "", end: cells[3] ?? "" };
}

function validDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const round = (h: number) => Math.round(h * 100) / 100;

export class TimeEntryEditor {
  constructor(private app: App) {}

  /** Every session logged on this task, newest first, each counted once */
  async list(ws: Workspace, task: TFile): Promise<LoggedTime[]> {
    const out = new Map<string, LoggedTime>();
    const folders = timeEntryFolders(ws);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!isUnderAnyFolder(file.path, folders)) continue;
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!cached || linkSlug(cached.task) !== task.basename) continue;
      // The values are read from the file itself: the metadata cache lags a
      // beat behind a write, and a recount straight after an edit would
      // otherwise see the old start time and count the session twice
      const fm = await this.readFrontmatter(file);
      if (!fm || fm.hours === undefined) continue;
      const start = validDate(fm.start_time);
      const end = validDate(fm.end_time);
      const key = `${fm.start_time ?? ""}|${fm.end_time ?? ""}`;
      out.set(key, {
        key,
        hours: Number(fm.hours) || 0,
        iso: start ? toISODate(start) : String(fm.created ?? ""),
        start,
        end,
        entryFile: file,
        row: null,
      });
    }

    const content = await this.app.vault.read(task);
    for (const line of content.split("\n")) {
      const row = parseRow(line);
      if (!row) continue;
      const key = row.start || row.end ? `${row.start}|${row.end}` : `row:${line}`;
      const known = out.get(key);
      if (known) {
        known.row = line;
        continue;
      }
      const start = validDate(row.start);
      out.set(key, {
        key,
        hours: row.hours,
        iso: start ? toISODate(start) : row.date,
        start,
        end: validDate(row.end),
        entryFile: null,
        row: line,
      });
    }

    return [...out.values()].sort((a, b) =>
      a.iso === b.iso ? (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0) : a.iso < b.iso ? 1 : -1
    );
  }

  private async readFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
    const text = await this.app.vault.read(file);
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    try {
      return (parseYaml(m[1]) as Record<string, unknown>) ?? null;
    } catch {
      return null;
    }
  }

  /** Moves a session to a new start and length, in every place it is recorded */
  async update(ws: Workspace, task: TFile, item: LoggedTime, start: Date, hours: number): Promise<void> {
    const h = round(hours);
    const end = new Date(start.getTime() + h * 3600000);
    if (item.entryFile) {
      await this.app.fileManager.processFrontMatter(item.entryFile, (fm) => {
        fm.hours = h;
        fm.start_time = start.toISOString();
        fm.end_time = end.toISOString();
        fm.time_entry = toISOFileStamp(end);
      });
    }
    const newRow = `| ${toISODate(start)} | ${h} | ${start.toISOString()} | ${end.toISOString()} |`;
    await this.app.vault.process(task, (content) => {
      if (item.row && content.includes(item.row)) return content.replace(item.row, newRow);
      // A session that only had an entry note gets its row back
      if (content.includes(ROW_HEADER)) return content.replace(/\n?$/, "\n") + newRow + "\n";
      return content + `\n## Time Log\n\n${ROW_HEADER}\n|------|-------|-------|-----|\n${newRow}\n`;
    });
    await this.recount(ws, task);
  }

  /** Removes a session from every place it is recorded */
  async remove(ws: Workspace, task: TFile, item: LoggedTime, behaviour: DeleteBehaviour): Promise<void> {
    if (item.entryFile) await deleteNote(this.app, item.entryFile, behaviour);
    if (item.row) {
      const row = item.row;
      await this.app.vault.process(task, (content) => {
        const lines = content.split("\n");
        const i = lines.indexOf(row);
        if (i >= 0) lines.splice(i, 1);
        return lines.join("\n");
      });
    }
    await this.recount(ws, task);
  }

  /** Sets the task's total_hours and days_count from what is logged */
  async recount(ws: Workspace, task: TFile): Promise<{ hours: number; days: number }> {
    const items = await this.list(ws, task);
    const hours = round(items.reduce((s, i) => s + i.hours, 0));
    const days = new Set(items.filter((i) => i.hours > 0).map((i) => i.iso)).size;
    await this.app.fileManager.processFrontMatter(task, (fm) => {
      fm.total_hours = hours;
      fm.days_count = days;
    });
    return { hours, days };
  }
}
