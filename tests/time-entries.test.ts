import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "./helpers";
import { TimeEntryEditor } from "../src/managers/TimeEntryEditor";
import { isoToDate } from "../src/utils/Jalali";

async function withEntries() {
  const s = await setup();
  const editor = new TimeEntryEditor(s.app as never);
  const task = await s.task("Report");
  await s.tracker.addManualEntry(s.ws, task as never, 2, "2026-09-01");
  await s.tracker.addManualEntry(s.ws, task as never, 1.5, "2026-09-03");
  await settle();
  return { ...s, editor, task };
}

test("each session is listed once, newest first", async () => {
  const s = await withEntries();
  const items = await s.editor.list(s.ws, s.task as never);
  assert.deepEqual(items.map((i) => [i.iso, i.hours, !!i.entryFile, !!i.row]), [
    ["2026-09-03", 1.5, true, true],
    ["2026-09-01", 2, true, true],
  ]);
});

test("deleting a session removes its note and row and fixes the totals", async () => {
  const s = await withEntries();
  const [newest] = await s.editor.list(s.ws, s.task as never);
  await s.editor.remove(s.ws, s.task as never, newest, "permanent");
  await settle();
  assert.equal(s.entries().length, 1);
  assert.equal(s.logRows(s.task).length, 1);
  assert.equal(s.fm(s.task).total_hours, 2);
  assert.equal(s.fm(s.task).days_count, 1);
  const data = await s.analytics.collect(s.ws);
  assert.deepEqual(data.records.map((r) => r.hours), [2], "the dashboard agrees");
});

test("editing a session moves it to its new day and length everywhere", async () => {
  const s = await withEntries();
  const items = await s.editor.list(s.ws, s.task as never);
  const older = items[1];
  const start = isoToDate("2026-09-05");
  start.setHours(9, 30, 0, 0);
  await s.editor.update(s.ws, s.task as never, older, start, 3);
  await settle();

  const after = await s.editor.list(s.ws, s.task as never);
  assert.deepEqual(after.map((i) => [i.iso, i.hours]), [["2026-09-05", 3], ["2026-09-03", 1.5]]);
  assert.equal(s.entries().length, 2, "no duplicate entry note");
  assert.equal(s.logRows(s.task).length, 2, "no duplicate row");
  assert.equal(s.fm(s.task).total_hours, 4.5);
  assert.equal(s.fm(s.task).days_count, 2);
  const data = await s.analytics.collect(s.ws);
  assert.deepEqual(data.records.map((r) => [r.iso, r.hours]), [["2026-09-03", 1.5], ["2026-09-05", 3]]);
});

test("an old row without times can be deleted too", async () => {
  const s = await setup();
  const editor = new TimeEntryEditor(s.app as never);
  const task = await s.task("Legacy");
  await s.app.vault.process(task, (c) => c + "| 2025-01-02 | 4 |\n");
  await settle();
  const items = await editor.list(s.ws, task as never);
  assert.equal(items.length, 1);
  await editor.remove(s.ws, task as never, items[0], "permanent");
  await settle();
  assert.equal(s.fm(task).total_hours, 0);
  assert.equal((await editor.list(s.ws, task as never)).length, 0);
});
