import { App, TFile, normalizePath } from "obsidian";
import { ActiveTimer, Workspace } from "../types";
import { toISOFileStamp, todayString } from "../utils/DateUtils";
import { TaskManager } from "./TaskManager";
import { isBacklogStatus } from "../utils/StatusColors";

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

  async stopTimer(ws: Workspace): Promise<number> {
    if (!this.activeTimer) throw new Error("No active timer");
    const t = this.activeTimer;

    // Logged hours are time actually worked, pauses excluded — not the wall-clock
    // span from start to stop. Which is why diffHours is no longer used here.
    const hours = Math.round((this.getElapsedMs() / 3600000) * 100) / 100;
    const start = new Date(t.startedAt);
    const end = new Date();

    const taskFile = this.app.vault.getAbstractFileByPath(
      normalizePath(t.taskPath)
    ) as TFile | null;

    if (taskFile) {
      await this.taskManager.updateTaskHours(this.app, taskFile, hours, start, end);
      await this.writeTimeEntry(ws, taskFile, hours, start, end);
    }

    this.activeTimer = null;
    this.persist();
    return hours;
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
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + hours * 3600000);
    await this.taskManager.updateTaskHours(this.app, taskFile, hours, start, end);
    await this.writeTimeEntry(ws, taskFile, hours, start, end);
  }

  private async writeTimeEntry(
    ws: Workspace,
    taskFile: TFile,
    hours: number,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    const stamp = toISOFileStamp(endTime);
    const taskSlug = taskFile.basename;
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
