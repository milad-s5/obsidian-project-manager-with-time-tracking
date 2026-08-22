// ╔══════════════════════════════════════════════════════════════════════╗
// ║  AnalyticsManager — where every bit of the dashboard's raw data starts║
// ║  Time comes chiefly from the TimeEntries folder; the Time Log table  ║
// ║  rows inside older tasks are read too, and both are deduplicated on  ║
// ║  task|start|end so that no hour is ever counted twice.               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { App, TFile } from "obsidian";
import { Workspace } from "../types";
import { toISODate, todayISO, addDays, daysBetween } from "../utils/Jalali";
import { normalizeStatus } from "../utils/StatusColors";
import { linkSlug } from "../utils/FrontmatterUtils";
import {
  isArchivedPath, isUnderAnyFolder, projectFolders, taskFolders, timeEntryFolders,
} from "../utils/WorkspacePaths";

export interface TimeRecord {
  iso: string;          // the local day this time was logged against
  hours: number;
  taskSlug: string;
  taskTitle: string;
  taskPath: string;
  projectSlug: string;
  start: string;
  end: string;
}

export interface TaskInfo {
  file: TFile;
  slug: string;
  /** In the archive folder — still in the reports, only the file moved */
  archived: boolean;
  title: string;
  status: string;
  priority: string;
  projectSlug: string;
  due: string;
  created: string;
  totalHours: number;
  daysCount: number;
}

export interface ProjectInfo {
  file: TFile;
  slug: string;
  archived: boolean;
  title: string;
  status: string;
  priority: string;
  due: string;
  created: string;
  taskCount: number;
  doneCount: number;
  hours: number;
}

export interface AnalyticsData {
  records: TimeRecord[];
  tasks: TaskInfo[];
  projects: ProjectInfo[];
  tasksBySlug: Map<string, TaskInfo>;
  projectsBySlug: Map<string, ProjectInfo>;
  /** iso → that day's records, sorted by hours descending */
  byDay: Map<string, TimeRecord[]>;
  firstISO: string | null;
  lastISO: string | null;
}

const DONE_STATUSES = new Set(["done"]);
const CLOSED_STATUSES = new Set(["done", "cancel", "quite"]);

export function isDoneStatus(status: string): boolean { return DONE_STATUSES.has(status); }
export function isClosedStatus(status: string): boolean { return CLOSED_STATUSES.has(status); }

function unlink(value: unknown): string {
  return linkSlug(value);
}

export class AnalyticsManager {
  // Parsing Time Log tables costs a file read, so results are cached on mtime
  private tableCache = new Map<string, { mtime: number; rows: TimeRecord[] }>();

  constructor(private app: App) {}

  async collect(ws: Workspace): Promise<AnalyticsData> {
    const tasks = this.collectTasks(ws);
    const tasksBySlug = new Map(tasks.map((t) => [t.slug, t]));
    const projects = this.collectProjects(ws, tasks);
    const projectsBySlug = new Map(projects.map((p) => [p.slug, p]));

    const records: TimeRecord[] = [];
    const seen = new Set<string>();

    for (const rec of this.collectTimeEntryFiles(ws, tasksBySlug)) {
      const key = `${rec.taskSlug}|${rec.start}|${rec.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(rec);
    }

    for (const task of tasks) {
      for (const rec of await this.collectTaskTableRows(task)) {
        const key = `${rec.taskSlug}|${rec.start}|${rec.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(rec);
      }
    }

    records.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));

    const byDay = new Map<string, TimeRecord[]>();
    for (const rec of records) {
      const list = byDay.get(rec.iso);
      if (list) list.push(rec);
      else byDay.set(rec.iso, [rec]);
    }
    for (const list of byDay.values()) list.sort((a, b) => b.hours - a.hours);

    return {
      records,
      tasks,
      projects,
      tasksBySlug,
      projectsBySlug,
      byDay,
      firstISO: records.length ? records[0].iso : null,
      lastISO: records.length ? records[records.length - 1].iso : null,
    };
  }

  // ── Tasks and projects ──────────────────────────────────────────────
  private collectTasks(ws: Workspace): TaskInfo[] {
    const out: TaskInfo[] = [];
    const folders = taskFolders(ws);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!isUnderAnyFolder(file.path, folders)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type !== "task" || unlink(fm.workspace) !== ws.name) continue;
      out.push({
        file,
        slug: file.basename,
        archived: isArchivedPath(ws, file.path),
        title: String(fm.title ?? file.basename),
        status: normalizeStatus(fm.status ?? "todo"),
        priority: String(fm.priority ?? "medium"),
        projectSlug: unlink(fm.project),
        due: String(fm.due ?? ""),
        created: String(fm.created ?? ""),
        totalHours: Number(fm.total_hours ?? 0) || 0,
        daysCount: Number(fm.days_count ?? 0) || 0,
      });
    }
    return out;
  }

  private collectProjects(ws: Workspace, tasks: TaskInfo[]): ProjectInfo[] {
    const out: ProjectInfo[] = [];
    const folders = projectFolders(ws);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!isUnderAnyFolder(file.path, folders)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type !== "project" || unlink(fm.workspace) !== ws.name) continue;

      const slug = file.basename;
      const mine = tasks.filter((t) => t.projectSlug === slug);
      const counted = mine.filter((t) => isDoneStatus(t.status) || !isClosedStatus(t.status));
      out.push({
        file,
        slug,
        archived: isArchivedPath(ws, file.path),
        title: String(fm.title ?? file.basename),
        status: normalizeStatus(fm.status ?? "todo"),
        priority: String(fm.priority ?? "medium"),
        due: String(fm.due ?? ""),
        created: String(fm.created ?? ""),
        // Cancelled and abandoned tasks drop out of both halves of the ratio.
        // Counting them in the denominator made a finished project read as
        // "1/2" forever, since the second task was never going to be done.
        taskCount: counted.length,
        doneCount: counted.filter((t) => isDoneStatus(t.status)).length,
        hours: Math.round(mine.reduce((s, t) => s + t.totalHours, 0) * 100) / 100,
      });
    }
    return out;
  }

  // ── Source 1: TimeEntries files (frontmatter only, no file read) ────
  private collectTimeEntryFiles(ws: Workspace, tasksBySlug: Map<string, TaskInfo>): TimeRecord[] {
    const out: TimeRecord[] = [];
    const folders = timeEntryFolders(ws);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!isUnderAnyFolder(file.path, folders)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.hours === undefined) continue;

      const taskSlug = unlink(fm.task);
      const start = String(fm.start_time ?? "");
      const end = String(fm.end_time ?? "");
      const iso = this.resolveISO(start, String(fm.created ?? ""));
      if (!iso) continue;

      const task = tasksBySlug.get(taskSlug);
      out.push({
        iso,
        hours: Number(fm.hours ?? 0) || 0,
        taskSlug,
        taskTitle: task?.title ?? taskSlug,
        taskPath: task?.file.path ?? "",
        projectSlug: task?.projectSlug ?? "",
        start,
        end,
      });
    }
    return out;
  }

  // ── Source 2: the Time Log table inside a task, for older tasks ─────
  private async collectTaskTableRows(task: TaskInfo): Promise<TimeRecord[]> {
    const cached = this.tableCache.get(task.file.path);
    if (cached && cached.mtime === task.file.stat.mtime) return cached.rows;

    const rows: TimeRecord[] = [];
    let content: string;
    try {
      content = await this.app.vault.cachedRead(task.file);
    } catch {
      return rows;
    }

    for (const line of content.split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;

      const hours = Number(cells[1]);
      if (!Number.isFinite(hours)) continue;
      const start = cells[2] ?? "";
      const end = cells[3] ?? "";
      // The Date column is written as "today", so the real date comes from start_time
      const iso = this.resolveISO(start, cells[0]);
      if (!iso) continue;

      rows.push({
        iso,
        hours,
        taskSlug: task.slug,
        taskTitle: task.title,
        taskPath: task.file.path,
        projectSlug: task.projectSlug,
        start,
        end,
      });
    }

    this.tableCache.set(task.file.path, { mtime: task.file.stat.mtime, rows });
    return rows;
  }

  private resolveISO(startTime: string, fallback: string): string | null {
    if (startTime) {
      const d = new Date(startTime);
      if (!Number.isNaN(d.getTime())) return toISODate(d);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(fallback)) return fallback;
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Aggregations the views rely on
// ══════════════════════════════════════════════════════════════════════

export function sumHours(records: TimeRecord[]): number {
  return Math.round(records.reduce((s, r) => s + r.hours, 0) * 100) / 100;
}

export function recordsInRange(records: TimeRecord[], fromISO: string, toISO: string): TimeRecord[] {
  return records.filter((r) => r.iso >= fromISO && r.iso <= toISO);
}

/** Hours per day across the range — empty days come back as zero, which is the
 *  correct denominator for the heatmap */
export function hoursPerDay(records: TimeRecord[], days: string[]): Map<string, number> {
  const map = new Map<string, number>(days.map((d) => [d, 0]));
  for (const r of records) {
    if (map.has(r.iso)) map.set(r.iso, (map.get(r.iso) ?? 0) + r.hours);
  }
  for (const [k, v] of map) map.set(k, Math.round(v * 100) / 100);
  return map;
}

export function groupHoursBy<T>(
  records: TimeRecord[],
  key: (r: TimeRecord) => string,
  label: (slug: string) => string
): { slug: string; label: string; hours: number }[] {
  const map = new Map<string, number>();
  for (const r of records) {
    const k = key(r);
    map.set(k, (map.get(k) ?? 0) + r.hours);
  }
  return Array.from(map.entries())
    .map(([slug, hours]) => ({ slug, label: label(slug), hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours);
}

/** Consecutive days with logged work, counting back from today or yesterday */
export function currentStreak(byDay: Map<string, TimeRecord[]>): number {
  const today = todayISO();
  let cursor = hasWork(byDay, today) ? today : addDays(today, -1);
  let streak = 0;
  while (hasWork(byDay, cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function longestStreak(byDay: Map<string, TimeRecord[]>): number {
  const days = Array.from(byDay.keys())
    .filter((iso) => hasWork(byDay, iso))
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const iso of days) {
    run = prev && daysBetween(prev, iso) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = iso;
  }
  return best;
}

function hasWork(byDay: Map<string, TimeRecord[]>, iso: string): boolean {
  const list = byDay.get(iso);
  return !!list && list.some((r) => r.hours > 0);
}
