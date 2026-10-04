import { App, Notice } from "obsidian";
import type ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { ConfirmModal } from "./ConfirmModal";
import { StopResult } from "../managers/TimeTracker";

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

  const stopBtn = bar.createEl("button", { cls: "pm-btn pm-btn-danger", text: "⏹ Stop" });
  stopBtn.addEventListener("click", async () => {
    try {
      showStopNotice(await tracker.stopTimer(ws));
      onChange();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : String(err));
    }
  });
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
