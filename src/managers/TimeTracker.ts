import { App, TFile, normalizePath } from "obsidian";
import { ActiveTimer, Workspace } from "../types";
import { toISOFileStamp, todayString } from "../utils/DateUtils";
import { isoToDate } from "../utils/Jalali";
import { TaskManager } from "./TaskManager";
import { isBacklogStatus } from "../utils/StatusColors";
import { isUnderAnyFolder, taskFolders } from "../utils/WorkspacePaths";

export interface StopResult {
  hours: number;
  /** False when the task note could not be found: only the time entry was written */
  taskFound: boolean;
}

export class TimeTracker {
  private activeTimer: ActiveTimer | null = null;
  /** Every state change has to reach disk, or it will not survive a crash */
  private persist: () => void = () => {};

  constructor(private app: App, private taskManager: TaskManager) {}

  setPersistHandler(fn: () => void): void {
    this.persist = fn;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  startTimer(taskPath: string, taskTitle: string, workspaceId: string): void {
    if (this.activeTimer) {
      throw new Error(`Timer already running for: ${this.activeTimer.taskTitle}`);
    }
    const now = new Date().toISOString();
    this.activeTimer = {
      taskPath,
      taskTitle,
      workspaceId,
      startedAt: now,
      segmentStart: now,
      accumulatedMs: 0,
    };
    this.persist();
    void this.promoteFromBacklog(taskPath);
  }

  /** Working on a task is taking it on — it cannot stay in the backlog */
  private async promoteFromBacklog(taskPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(taskPath);
    if (!(file instanceof TFile)) return;
    if (!isBacklogStatus(this.app.metadataCache.getFileCache(file)?.frontmatter?.status)) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.status = "active";
    });
  }

  /** Closes the current segment and banks it. A no-op on a paused timer. */
  pause(): void {
    const t = this.activeTimer;
    if (!t) throw new Error("No active timer");
    if (!t.segmentStart) return;
    t.accumulatedMs += Date.now() - Date.parse(t.segmentStart);
    t.segmentStart = null;
    this.persist();
  }

  resume(): void {
    const t = this.activeTimer;
    if (!t) throw new Error("No active timer");
    if (t.segmentStart) return;
    t.segmentStart = new Date().toISOString();
    this.persist();
  }

  togglePause(): void {
    if (this.isPaused()) this.resume();
    else this.pause();
  }

  async stopTimer(ws: Workspace): Promise<StopResult> {
    if (!this.activeTimer) throw new Error("No active timer");
    const t = this.activeTimer;

    // Logged hours are time actually worked, pauses excluded — not the wall-clock
    // span from start to stop.
    const hours = Math.round((this.getElapsedMs() / 3600000) * 100) / 100;
    const start = new Date(t.startedAt);
    const end = new Date();

    // Taken off the tracker before the first await. A second Stop, from a
    // double-click or from Stop pressed in two views, then finds no timer
    // instead of logging the same session again.
    this.activeTimer = null;

    // The time entry is written even when the note cannot be found. Silently
    // dropping it, as this used to, lost the whole session while the notice
    // still said it had been logged.
    const taskFile = this.findTaskFile(t.taskPath, ws);
    try {
      // The entry goes first because it is the record that counts: if it
      // cannot be written, nothing has been logged and the timer can come back
      // exactly as it was.
      await this.writeTimeEntry(ws, taskFile?.basename ?? basenameOf(t.taskPath), hours, start, end);
    } catch (err) {
      if (!this.activeTimer) this.activeTimer = t;
      throw err;
    }
    this.persist();

    if (taskFile) {
      await this.taskManager.updateTaskHours(this.app, taskFile, hours, start, end);
    }
    return { hours, taskFound: !!taskFile };
  }

  /**
   * Keeps the timer on its task when the note is renamed or moved — which
   * archiving does the moment a task is marked done, timer running or not.
   * A renamed folder is followed too, for a task somewhere inside it.
   */
  handleRename(newPath: string, oldPath: string): void {
    const t = this.activeTimer;
    if (!t) return;
    if (t.taskPath === oldPath) t.taskPath = newPath;
    else if (t.taskPath.startsWith(`${oldPath}/`)) t.taskPath = newPath + t.taskPath.slice(oldPath.length);
    else return;
    this.persist();
  }

  /**
   * The timer's task note: where it was last seen, or — if it moved while
   * the plugin was not looking, say with Obsidian closed — the task of the
   * same name in this workspace.
   */
  private findTaskFile(taskPath: string, ws: Workspace): TFile | null {
    const byPath = this.app.vault.getAbstractFileByPath(normalizePath(taskPath));
    if (byPath instanceof TFile) return byPath;
    const name = basenameOf(taskPath);
    const folders = taskFolders(ws);
    return (
      this.app.vault.getMarkdownFiles().find(
        (f) =>
          f.basename === name &&
          isUnderAnyFolder(f.path, folders) &&
          this.app.metadataCache.getFileCache(f)?.frontmatter?.type === "task"
      ) ?? null
    );
  }

  /** Throws it away without logging — for when a restored timer is wrong */
  discard(): void {
    this.activeTimer = null;
    this.persist();
  }

  /**
   * Zeroes the counter while the timer stays open on the same task. Nothing is
   * logged, so the counted time is lost. The paused state is kept: a paused timer
   * is still paused after a reset rather than springing into life.
   */
  reset(): void {
    const t = this.activeTimer;
    if (!t) throw new Error("No active timer");
    const now = new Date().toISOString();
    t.accumulatedMs = 0;
    t.startedAt = now;
    t.segmentStart = t.segmentStart ? now : null;
    this.persist();
  }

  // ── Persistence ─────────────────────────────────────────────────────

  serialize(): ActiveTimer | null {
    return this.activeTimer;
  }

  /**
   * Restores a saved timer. Because elapsed time comes from timestamps, a timer
   * that was running during a crash also counts the downtime. That is deliberate:
   * we cannot know when it died. main.ts tells the user so they can discard it.
   */
  restore(saved: unknown): boolean {
    if (!saved || typeof saved !== "object") return false;
    const s = saved as Partial<ActiveTimer>;
    if (typeof s.taskPath !== "string" || !s.taskPath) return false;
    if (typeof s.startedAt !== "string" || Number.isNaN(Date.parse(s.startedAt))) return false;
    const segmentStart =
      typeof s.segmentStart === "string" && !Number.isNaN(Date.parse(s.segmentStart))
        ? s.segmentStart
        : null;

    this.activeTimer = {
      taskPath: s.taskPath,
      taskTitle: typeof s.taskTitle === "string" ? s.taskTitle : s.taskPath,
      workspaceId: typeof s.workspaceId === "string" ? s.workspaceId : "",
      startedAt: s.startedAt,
      segmentStart,
      accumulatedMs: Number.isFinite(s.accumulatedMs as number)
        ? Math.max(0, s.accumulatedMs as number)
        : 0,
    };
    return true;
  }

  // ── Reading state ───────────────────────────────────────────────────

  getActiveTimer(): ActiveTimer | null {
    return this.activeTimer;
  }

  getElapsedMs(): number {
    const t = this.activeTimer;
    if (!t) return 0;
    return t.accumulatedMs + (t.segmentStart ? Date.now() - Date.parse(t.segmentStart) : 0);
  }

  getElapsed(): string {
    const ms = this.getElapsedMs();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  /** There is a timer, whether it is counting or paused */
  isRunning(): boolean {
    return this.activeTimer !== null;
  }

  isPaused(): boolean {
    return this.activeTimer !== null && this.activeTimer.segmentStart === null;
  }

  /** Actually counting — neither stopped nor paused */
  isTicking(): boolean {
    return this.activeTimer !== null && this.activeTimer.segmentStart !== null;
  }

  getActiveTaskPath(): string | null {
    return this.activeTimer?.taskPath ?? null;
  }

  // ── Writing ─────────────────────────────────────────────────────────

  async addManualEntry(
    ws: Workspace,
    taskFile: TFile,
    hours: number,
    date: string
  ): Promise<void> {
    // Local noon of that day. This used to be midnight UTC, which west of UTC
    // is still the evening before, so the entry landed a day early. Noon also
    // keeps the day when the vault is later opened a few timezones away.
    const start = isoToDate(date);
    const end = new Date(start.getTime() + hours * 3600000);
    await this.writeTimeEntry(ws, taskFile.basename, hours, start, end);
    await this.taskManager.updateTaskHours(this.app, taskFile, hours, start, end);
  }

  private async writeTimeEntry(
    ws: Workspace,
    taskSlug: string,
    hours: number,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    const stamp = toISOFileStamp(endTime);
    let path = normalizePath(`${ws.timeEntriesFolder}/time_entry_${taskSlug}_${stamp}.md`);

    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${ws.timeEntriesFolder}/time_entry_${taskSlug}_${stamp}_${counter}.md`);
      counter++;
    }

    const content = `---
time_entry: "${toISOFileStamp(endTime)}"
task: "[[${taskSlug}]]"
hours: ${hours}
start_time: "${startTime.toISOString()}"
end_time: "${endTime.toISOString()}"
created: "${todayString()}"
---
`;
    await this.app.vault.create(path, content);
  }
}

/** "Tasks/write-report.md" → "write-report" */
function basenameOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}
