import { App, Notice } from "obsidian";
import type ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { ConfirmModal } from "./ConfirmModal";
import { StopResult } from "../managers/TimeTracker";
import { TaskPickerModal } from "./TaskPickerModal";
import { listProjectOptions } from "../utils/WorkspacePaths";

/** Below this there is nothing to lose, so reset without asking */
const RESET_CONFIRM_THRESHOLD_MS = 60_000;

/**
 * Reset: the counter goes to zero and nothing is logged. Since the counted time
 * does not come back, we ask first when there is anything meaningful on it.
 */
export function resetTimerWithConfirm(
  app: App,
  plugin: ProjectManagerPlugin,
  onChange: () => void
): void {
  const tracker = plugin.timeTracker;
  if (!tracker.isRunning()) return;

  const doReset = () => {
    tracker.reset();
    onChange();
  };

  if (tracker.getElapsedMs() < RESET_CONFIRM_THRESHOLD_MS) {
    doReset();
    return;
  }

  new ConfirmModal(app, {
    title: "Reset timer?",
    body:
      `${tracker.getElapsed()} on “${tracker.getActiveTimer()?.taskTitle}” will be ` +
      `discarded without being logged. The timer keeps running from zero.`,
    confirmText: "Reset",
    onConfirm: () => {
      const lost = tracker.getElapsed();
      doReset();
      new Notice(`Timer reset — ${lost} discarded`);
    },
  }).open();
}

/**
 * The active timer bar — one implementation shared by the kanban and the
 * dashboard, so the pause button cannot exist in only one of them.
 *
 * onChange fires after each action so the hosting view can re-render.
 */
export function renderTimerBar(
  parent: HTMLElement,
  plugin: ProjectManagerPlugin,
  ws: Workspace,
  onChange: () => void
): void {
  const tracker = plugin.timeTracker;
  if (!tracker.isRunning()) return;

  const paused = tracker.isPaused();
  const bar = parent.createDiv({ cls: `pm-timer-bar${paused ? " paused" : ""}` });

  bar.createSpan({ cls: "pm-timer-dot", attr: { "aria-hidden": "true" } });
  bar.createSpan({ cls: "pm-timer-task", text: tracker.getActiveTimer()?.taskTitle ?? "" });
  bar.createSpan({ cls: "pm-timer-elapsed", text: tracker.getElapsed() });
  if (paused) bar.createSpan({ cls: "pm-timer-badge", text: "paused" });

  const pauseBtn = bar.createEl("button", {
    cls: "pm-btn pm-btn-secondary",
    text: paused ? "▶ Resume" : "⏸ Pause",
  });
  pauseBtn.addEventListener("click", () => {
    tracker.togglePause();
    onChange();
  });

  const resetBtn = bar.createEl("button", {
    cls: "pm-btn pm-btn-secondary",
    text: "⟲ Reset",
    attr: { "aria-label": "Reset the timer to zero without logging" },
  });
  resetBtn.addEventListener("click", () => {
    resetTimerWithConfirm(plugin.app, plugin, onChange);
  });

  if (tracker.hasNoTask()) {
    bar.addClass("no-task");
    bar.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Choose task…" })
      .addEventListener("click", () => void chooseTimerTask(plugin, ws, onChange));
  }

  const stopBtn = bar.createEl("button", { cls: "pm-btn pm-btn-danger", text: "⏹ Stop" });
  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    await stopTimerAndLog(plugin, ws, onChange);
    stopBtn.disabled = false;
  });
}

/**
 * Asks which task the running timer is for, an existing one or a new one
 * by the title typed, and gives the timer that task. Dismissing it changes
 * nothing: the timer keeps running.
 */
export async function chooseTimerTask(
  plugin: ProjectManagerPlugin,
  fallback: Workspace,
  then?: () => void | Promise<void>
): Promise<void> {
  const tracker = plugin.timeTracker;
  const timer = tracker.getActiveTimer();
  if (!timer) return;
  const ws = plugin.findWorkspace(timer.workspaceId) ?? fallback;
  const tasks = await plugin.taskManager.getTasks(ws);
  const titles = new Map(listProjectOptions(plugin.app, ws).map((p) => [p.slug, p.title]));
  new TaskPickerModal(plugin.app, tasks, (slug) => titles.get(slug) ?? slug, async (choice) => {
    if (!tracker.isRunning()) return;
    try {
      if ("create" in choice) {
        const file = await plugin.taskManager.createTask(ws, choice.create, "", "active", "medium", "");
        tracker.assign(file.path, choice.create);
      } else {
        tracker.assign(choice.file.path, choice.title);
      }
    } catch (err) {
      new Notice(err instanceof Error ? err.message : String(err));
      return;
    }
    plugin.refreshTimerViews();
    await then?.();
  }).open();
}

/** Stop: logs the time, first asking which task it was for when the timer has none */
export async function stopTimerAndLog(
  plugin: ProjectManagerPlugin,
  ws: Workspace,
  onDone: () => void = () => {}
): Promise<void> {
  const tracker = plugin.timeTracker;
  const stop = async () => {
    try {
      showStopNotice(await tracker.stopTimer(ws));
    } catch (err) {
      new Notice(err instanceof Error ? err.message : String(err));
    }
    plugin.refreshTimerViews();
    onDone();
  };
  if (tracker.hasNoTask()) await chooseTimerTask(plugin, ws, stop);
  else await stop();
}

/** Says what a stop logged — differently when the task note itself was gone */
export function showStopNotice(result: StopResult): void {
  new Notice(
    result.taskFound
      ? `Stopped. Logged ${result.hours}h`
      : `Stopped. Logged ${result.hours}h as a time entry — the task note was not found`
  );
}

/**
 * Refreshes every elapsed-time display inside this container.
 *
 * This used to be a single querySelector, so only the first element — the bar at
 * the top — ever ticked, and the timer on a task card stayed forever at whatever
 * it read when rendered, namely 0:00:00.
 */
export function tickTimerDisplays(container: HTMLElement, plugin: ProjectManagerPlugin): void {
  const text = plugin.timeTracker.getElapsed();
  container.querySelectorAll(".pm-timer-elapsed").forEach((el) => {
    el.textContent = text;
  });
}
