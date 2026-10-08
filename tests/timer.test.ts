import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle, workspace } from "./helpers";

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

test("a manual entry counts for the day it was entered for", async () => {
  const s = await setup();
  const task = await s.task("Design");
  await s.tracker.addManualEntry(s.ws, task as never, 3, "2026-09-01");
  await settle();

  const data = await s.analytics.collect(s.ws);
  assert.deepEqual(data.records.map((r) => r.iso), ["2026-09-01"], `TZ=${process.env.TZ}`);
  assert.match(s.logRows(task)[0], /^\| 2026-09-01 \| 3 \|/);
  assert.equal(s.fm(task).days_count, 1);
  assert.equal(s.fm(task).total_hours, 3);
});

test("a timer stops into the workspace it was started in", async () => {
  const home = { ...workspace("Home", "ws_home") };
  const s = await setup({ workspaces: [workspace(), home] });
  s.tracker.setWorkspaceResolver((id) => s.workspaces.find((w) => w.id === id || `[[${w.name}]]` === id) ?? null);
  const task = await s.task("Client call");
  s.tracker.startTimer(task.path, "Client call", s.ws.id);
  s.backdate(30);

  // The board shows Home by the time Stop is pressed
  await s.tracker.stopTimer(home);
  await settle();
  assert.deepEqual(s.entries().map((f) => f.path.split("/")[0]), ["Work"]);
});

test("two entries in quick succession both count", async () => {
  const s = await setup();
  const task = await s.task("Busy");
  s.app.metadataCache.delay = 50; // the cache lags well behind the writes
  await s.tracker.addManualEntry(s.ws, task as never, 1, "2026-09-01");
  await s.tracker.addManualEntry(s.ws, task as never, 2, "2026-09-02");
  await settle(120);
  assert.equal(s.fm(task).total_hours, 3);
});

test("a timer started on no task logs nothing until it is given one, and keeps its time", async () => {
  const s = await setup();
  const t = await s.task("Found it later", "", "backlog");
  s.tracker.startWithoutTask(s.ws.id);
  assert.ok(s.tracker.hasNoTask());
  assert.equal(s.tracker.getActiveTaskPath(), null);
  s.backdate(30);
  await assert.rejects(s.tracker.stopTimer(s.ws), /Choose a task/);
  assert.ok(s.tracker.isRunning(), "still running after a refused stop");
  // Starting on a task gives the running timer that task instead
  s.tracker.startTimer(t.path, "Found it later", s.ws.id);
  assert.equal(s.tracker.getActiveTaskPath(), t.path);
  const r = await s.tracker.stopTimer(s.ws);
  await settle();
  assert.equal(r.hours, 0.5);
  assert.equal(s.fm(t).total_hours, 0.5);
  assert.equal(s.fm(t).status, "active", "taken out of the backlog");
});

test("a timer on no task survives a restart", async () => {
  const s = await setup();
  s.tracker.startWithoutTask(s.ws.id);
  const saved = JSON.parse(JSON.stringify(s.tracker.serialize()));
  s.tracker.discard();
  assert.ok(s.tracker.restore(saved));
  assert.ok(s.tracker.hasNoTask());
});
