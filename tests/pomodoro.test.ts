import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POMODORO, PomodoroClock, PomodoroSettings } from "../src/features/pomodoro";

function rig(over: Partial<PomodoroSettings> = {}) {
  const s: PomodoroSettings = { ...DEFAULT_POMODORO, enabled: true, workMinutes: 2, shortBreakMinutes: 1, longBreakMinutes: 3, longBreakEvery: 2, ...over };
  const state = { task: "t.md" as string | null, ticking: true };
  const log: string[] = [];
  const clock = new PomodoroClock(() => s, {
    taskPath: () => state.task,
    ticking: () => state.ticking,
    pause: () => { state.ticking = false; log.push("pause"); },
    resume: () => { state.ticking = true; log.push("resume"); },
  }, {
    roundDone: (_t, m, long) => log.push(`done ${m}${long ? " long" : ""}`),
    breakOver: (r) => log.push(`over ${r}`),
  });
  let now = 1_000_000;
  const run = (seconds: number) => { for (let i = 0; i < seconds; i++) { now += 1000; clock.tick(now); } };
  clock.tick(now);
  return { clock, state, log, run };
}

test("a round pauses the timer for a break, then resumes it", () => {
  const r = rig();
  r.run(119);
  assert.deepEqual(r.log, []);
  r.run(1);
  assert.deepEqual(r.log, ["pause", "done 1"]);
  assert.equal(r.clock.phase, "break");
  r.run(60);
  assert.deepEqual(r.log, ["pause", "done 1", "resume", "over true"]);
  assert.equal(r.clock.phase, "work");
});

test("every second round ends in the long break", () => {
  const r = rig();
  r.run(120); r.run(60); r.run(120);
  assert.deepEqual(r.log.filter((l) => l.startsWith("done")), ["done 1", "done 3 long"]);
});

test("time paused by hand does not count", () => {
  const r = rig();
  r.run(60);
  r.state.ticking = false;
  r.run(600);
  r.state.ticking = true;
  r.run(59);
  assert.deepEqual(r.log, []);
  r.run(1);
  assert.deepEqual(r.log, ["pause", "done 1"]);
});

test("without auto-resume the break ends and waits", () => {
  const r = rig({ autoResume: false });
  r.run(120); r.run(60);
  assert.deepEqual(r.log, ["pause", "done 1", "over false"]);
  assert.equal(r.state.ticking, false);
});

test("stopping the timer resets the round", () => {
  const r = rig();
  r.run(90);
  r.state.task = null;
  r.run(1);
  assert.equal(r.clock.phase, "idle");
  r.state.task = "t.md";
  r.run(119);
  assert.deepEqual(r.log, [], "a fresh round of the full length");
});
