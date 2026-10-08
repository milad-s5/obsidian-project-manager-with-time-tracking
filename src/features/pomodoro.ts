// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Pomodoro                                                            ║
// ║  Rides on the ordinary timer: after a work round of running time it  ║
// ║  pauses the timer for a break, then (optionally) resumes it. Only    ║
// ║  time the timer actually runs counts towards a round, so pausing by  ║
// ║  hand simply holds the round where it is. Each finished round adds   ║
// ║  one to the task's `pomodoros` frontmatter field.                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Notice, Setting, TFile } from "obsidian";
import type ProjectManagerPlugin from "../main";

export interface PomodoroSettings {
  enabled: boolean;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Every how many rounds the break is the long one */
  longBreakEvery: number;
  /** Start the timer again by itself when a break ends */
  autoResume: boolean;
}

export const DEFAULT_POMODORO: PomodoroSettings = {
  enabled: false,
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoResume: true,
};

/** What the clock needs from the timer, so it can be tested on its own */
export interface TimerPort {
  /** The running timer's task, or null when there is none */
  taskPath(): string | null;
  ticking(): boolean;
  pause(): void;
  resume(): void;
}

export type PomodoroPhase = "idle" | "work" | "break";

export interface PomodoroEvents {
  roundDone(taskPath: string, breakMinutes: number, long: boolean): void;
  breakOver(resumed: boolean): void;
}

/**
 * The rounds and breaks. tick() is called about once a second with the time
 * now; a long gap between ticks (a sleeping laptop) is not counted as work.
 */
export class PomodoroClock {
  phase: PomodoroPhase = "idle";
  workMs = 0;
  breakEndsAt = 0;
  rounds = 0;
  private task: string | null = null;
  private last = 0;

  constructor(private settings: () => PomodoroSettings, private timer: TimerPort, private events: PomodoroEvents) {}

  tick(now: number): void {
    const s = this.settings();
    const delta = this.last ? Math.min(now - this.last, 5000) : 0;
    this.last = now;
    const task = this.timer.taskPath();
    if (!s.enabled || !task) {
      this.reset();
      return;
    }
    if (task !== this.task) {
      // A different task starts its own round
      this.task = task;
      this.workMs = 0;
      this.phase = "work";
    }

    if (this.phase === "break") {
      if (this.timer.ticking()) {
        // Resumed by hand before the break was over: a fresh round starts
        this.phase = "work";
        this.workMs = 0;
      } else if (now >= this.breakEndsAt) {
        this.phase = "work";
        this.workMs = 0;
        if (s.autoResume) this.timer.resume();
        this.events.breakOver(s.autoResume);
      }
      return;
    }

    this.phase = "work";
    if (!this.timer.ticking()) return;
    this.workMs += delta;
    if (this.workMs < s.workMinutes * 60000) return;

    this.rounds++;
    const long = s.longBreakEvery > 0 && this.rounds % s.longBreakEvery === 0;
    const minutes = long ? s.longBreakMinutes : s.shortBreakMinutes;
    this.timer.pause();
    this.phase = "break";
    this.workMs = 0;
    this.breakEndsAt = now + minutes * 60000;
    this.events.roundDone(task, minutes, long);
  }

  /** Ends the break now */
  skipBreak(now: number): void {
    if (this.phase !== "break") return;
    this.breakEndsAt = now;
    this.tick(now);
  }

  /** Milliseconds left in the current round or break */
  remaining(now: number): number {
    if (this.phase === "break") return Math.max(0, this.breakEndsAt - now);
    if (this.phase === "work") return Math.max(0, this.settings().workMinutes * 60000 - this.workMs);
    return 0;
  }

  private reset(): void {
    this.phase = "idle";
    this.workMs = 0;
    this.task = null;
  }
}

const mmss = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** A desktop notification as well as a notice, since the point is to be told while away */
function announce(message: string): void {
  new Notice(message, 10000);
  try {
    if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
      new Notification("Pomodoro", { body: message, silent: false });
    }
  } catch {
    // Not available here; the notice is enough
  }
}

export function setupPomodoro(plugin: ProjectManagerPlugin): void {
  const settings = () => plugin.settings.pomodoro;
  const tracker = plugin.timeTracker;

  const clock = new PomodoroClock(
    settings,
    {
      taskPath: () => tracker.getActiveTaskPath(),
      ticking: () => tracker.isTicking(),
      pause: () => { tracker.pause(); plugin.refreshTimerViews(); },
      resume: () => { if (tracker.isPaused()) { tracker.resume(); plugin.refreshTimerViews(); } },
    },
    {
      roundDone: (taskPath, minutes, long) => {
        const file = plugin.app.vault.getAbstractFileByPath(taskPath);
        if (file instanceof TFile) {
          void plugin.app.fileManager.processFrontMatter(file, (fm) => {
            fm.pomodoros = (Number(fm.pomodoros) || 0) + 1;
          });
        }
        announce(`Pomodoro done. Take a ${long ? "long " : ""}${minutes}-minute break — the timer is paused.`);
      },
      breakOver: (resumed) => {
        announce(resumed ? "Break over — the timer is running again." : "Break over — resume the timer when you are ready.");
      },
    }
  );

  // Its own status bar item, beside the timer's: round or break time left
  const item = plugin.addStatusBarItem();
  item.addClass("pm-statusbar-pomodoro");
  const paint = (now: number) => {
    const show = settings().enabled && clock.phase !== "idle";
    item.toggleClass("pm-hidden", !show);
    if (!show) return;
    item.setText(clock.phase === "break" ? `☕ ${mmss(clock.remaining(now))}` : `🍅 ${mmss(clock.remaining(now))}`);
    item.setAttr("aria-label", clock.phase === "break" ? "Pomodoro break left" : "Pomodoro round left");
  };
  plugin.registerInterval(window.setInterval(() => {
    const now = Date.now();
    clock.tick(now);
    paint(now);
  }, 1000));
  paint(Date.now());

  plugin.addCommand({
    id: "pomodoro-skip-break",
    name: "Pomodoro: end the break now",
    checkCallback: (checking) => {
      if (clock.phase !== "break") return false;
      if (!checking) clock.skipBreak(Date.now());
      return true;
    },
  });

  // 🍅 count on task cards
  plugin.ext.cardDecorators.push(({ board, fm, meta }) => {
    const n = Number(fm.pomodoros) || 0;
    if (board !== "tasks" || !n || !settings().enabled) return;
    meta.createSpan({ cls: "pm-card-pomodoros", text: `🍅 ${n}`, attr: { "aria-label": `${n} pomodoros` } });
  });

  plugin.ext.settingsSections.push((el) => {
    new Setting(el).setName("Pomodoro").setHeading();
    const save = async () => { await plugin.saveSettings(); };
    new Setting(el)
      .setName("Use Pomodoro rounds")
      .setDesc("After each work round of running time the timer pauses for a break. Finished rounds are counted on the task.")
      .addToggle((t) => t.setValue(settings().enabled).onChange(async (v) => { settings().enabled = v; await save(); plugin.refreshTimerViews(); }));
    const number = (name: string, key: "workMinutes" | "shortBreakMinutes" | "longBreakMinutes" | "longBreakEvery", desc: string) =>
      new Setting(el).setName(name).setDesc(desc).addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setValue(String(settings()[key])).onChange(async (v) => {
          const n = Math.round(Number(v));
          if (Number.isFinite(n) && n >= 1) { settings()[key] = n; await save(); }
        });
      });
    number("Work round", "workMinutes", "Minutes of running time in one round.");
    number("Short break", "shortBreakMinutes", "Minutes.");
    number("Long break", "longBreakMinutes", "Minutes.");
    number("Long break every", "longBreakEvery", "Rounds between long breaks.");
    new Setting(el)
      .setName("Resume after a break")
      .setDesc("Start the timer again by itself when the break is over.")
      .addToggle((t) => t.setValue(settings().autoResume).onChange(async (v) => { settings().autoResume = v; await save(); }));
  });
}
