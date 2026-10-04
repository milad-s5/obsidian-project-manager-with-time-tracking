import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "./helpers";

test("time is kept when the task is archived while its timer runs", async () => {
  const s = await setup();
  s.app.vault.on("rename", (f: { path: string }, old: string) => s.tracker.handleRename(f.path, old));
  const task = await s.task("Write report");
  s.tracker.startTimer(task.path, "Write report", s.ws.id);
  s.backdate(90);

  // What dragging the card to "done" does
  await s.app.fileManager.processFrontMatter(task, (fm) => { fm.status = "done"; });
  await settle();
  await s.archive.syncTask(s.ws, task as never);
  await settle();
  assert.match(task.path, /Archive\/Tasks\//);
  assert.equal(s.tracker.getActiveTaskPath(), task.path, "the timer followed the note");

  const result = await s.tracker.stopTimer(s.ws);
  await settle();
  assert.equal(result.hours, 1.5);
  assert.equal(result.taskFound, true);
  assert.equal(s.fm(task).total_hours, 1.5);
  assert.equal(s.entries().length, 1);
});

test("a note moved while nobody was looking is found by name", async () => {
  const s = await setup();
  const task = await s.task("Fix bug");
  s.tracker.startTimer(task.path, "Fix bug", s.ws.id);
  s.backdate(30);
  // No rename listener: as if Obsidian was closed when the file moved
  await s.app.fileManager.renameFile(task, "Work/Archive/Tasks/fix-bug.md");
  await settle();

  const result = await s.tracker.stopTimer(s.ws);
  await settle();
  assert.equal(result.taskFound, true);
  assert.equal(s.fm(task).total_hours, 0.5);
});

test("a deleted note still leaves its time entry behind", async () => {
  const s = await setup();
  const task = await s.task("Gone");
  s.tracker.startTimer(task.path, "Gone", s.ws.id);
  s.backdate(60);
  await s.app.vault.delete(task);

  const result = await s.tracker.stopTimer(s.ws);
  await settle();
  assert.deepEqual(result, { hours: 1, taskFound: false });
  assert.equal(s.entries().length, 1);
  assert.equal(s.fm(s.entries()[0]).task, "[[gone]]");
});

test("a renamed folder carries the timer along", async () => {
  const s = await setup();
  const task = await s.task("Deep");
  s.tracker.startTimer(task.path, "Deep", s.ws.id);
  s.tracker.handleRename("Other/Tasks", "Work/Tasks");
  assert.equal(s.tracker.getActiveTaskPath(), "Other/Tasks/deep.md");
});

test("pressing Stop twice logs the session once", async () => {
  const s = await setup({ latency: 15 });
  const task = await s.task("Fix login");
  s.tracker.startTimer(task.path, "Fix login", s.ws.id);
  s.backdate(60);

  const first = s.tracker.stopTimer(s.ws);
  await new Promise((r) => setTimeout(r, 5)); // the second click lands mid-save
  await assert.rejects(s.tracker.stopTimer(s.ws), /No active timer/);
  assert.equal((await first).hours, 1);
  await settle(40);

  assert.equal(s.entries().length, 1);
  assert.equal(s.logRows(task).length, 1);
  assert.equal(s.fm(task).total_hours, 1);
});

test("a failed write gives the timer back untouched", async () => {
  const s = await setup();
  const task = await s.task("Unlucky");
  s.tracker.startTimer(task.path, "Unlucky", s.ws.id);
  s.backdate(45);
  const before = { ...s.tracker.getActiveTimer()! };
  // The entry has nowhere to go
  await s.app.vault.delete(s.app.vault.getAbstractFileByPath("Work/TimeEntries")!);

  await assert.rejects(s.tracker.stopTimer(s.ws), /ENOENT/);
  assert.deepEqual(s.tracker.getActiveTimer(), before);
  assert.equal(s.fm(task).total_hours, 0, "nothing was half-logged");
});
