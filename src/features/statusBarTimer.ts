// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Status bar timer                                                     ║
// ║  The running timer in Obsidian's status bar, so it stays in sight     ║
// ║  while writing in any note, with its controls one click away.         ║
// ║  Obsidian's mobile apps have no status bar, so there it does nothing. ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Menu, Notice, TFile } from "obsidian";
import type ProjectManagerPlugin from "../main";
import { resetTimerWithConfirm, showStopNotice } from "../views/TimerBar";

export function setupStatusBarTimer(plugin: ProjectManagerPlugin): void {
  const item = plugin.addStatusBarItem();
  item.addClass("pm-statusbar-timer", "mod-clickable");
  const tracker = plugin.timeTracker;

  const paint = (): void => {
    const timer = tracker.getActiveTimer();
    item.toggleClass("pm-hidden", !timer);
    if (!timer) return;
    item.toggleClass("is-paused", tracker.isPaused());
    item.setText(`${tracker.isPaused() ? "⏸" : "⏱"} ${timer.taskTitle} — ${tracker.getElapsed()}`);
    item.setAttr("aria-label", tracker.isPaused() ? "Timer paused — click for options" : "Timer running — click for options");
  };

  item.addEventListener("click", (e) => {
    const timer = tracker.getActiveTimer();
    if (!timer) return;
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle(tracker.isPaused() ? "Resume" : "Pause").setIcon(tracker.isPaused() ? "play" : "pause").onClick(() => {
        tracker.togglePause();
        plugin.refreshTimerViews();
      })
    );
    menu.addItem((i) =>
      i.setTitle("Stop and log").setIcon("square").onClick(async () => {
        try {
          showStopNotice(await tracker.stopTimer(plugin.getCurrentWorkspace()));
        } catch (err) {
          new Notice(err instanceof Error ? err.message : String(err));
        }
        plugin.refreshTimerViews();
      })
    );
    menu.addItem((i) =>
      i.setTitle("Reset to zero").setIcon("rotate-ccw").onClick(() => {
        resetTimerWithConfirm(plugin.app, plugin, () => plugin.refreshTimerViews());
      })
    );
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle("Open task").setIcon("file-text").onClick(() => {
        const file = plugin.app.vault.getAbstractFileByPath(timer.taskPath);
        if (file instanceof TFile) plugin.openTaskModal(file, plugin.workspaceOfFile(file) ?? plugin.getCurrentWorkspace());
      })
    );
    menu.showAtMouseEvent(e);
  });

  plugin.registerEvent(plugin.events.on("timer-changed", paint));
  plugin.registerInterval(window.setInterval(() => { if (tracker.isTicking()) paint(); }, 1000));
  paint();
}
