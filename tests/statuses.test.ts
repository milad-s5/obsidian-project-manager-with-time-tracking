import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "./helpers";
import { DEFAULT_CLOSED_STATUSES, isClosedStatus, setClosedStatuses } from "../src/utils/StatusColors";

test("closed statuses come from the setting, and done always closes", () => {
  setClosedStatuses(["Dropped "]);
  assert.equal(isClosedStatus("dropped"), true);
  assert.equal(isClosedStatus("done"), true);
  assert.equal(isClosedStatus("cancel"), false);
  setClosedStatuses(DEFAULT_CLOSED_STATUSES);
});

test("a custom closing status sends a task to the archive", async () => {
  setClosedStatuses(["done", "dropped"]);
  try {
    const s = await setup();
    const t = await s.task("Abandoned idea");
    await s.app.fileManager.processFrontMatter(t, (fm) => { fm.status = "dropped"; });
    await settle();
    const r = await s.archive.syncTask(s.ws, t as never);
    assert.equal(r.moved, 1);
    assert.match(t.path, /Archive\/Tasks/);
  } finally {
    setClosedStatuses(DEFAULT_CLOSED_STATUSES);
  }
});

test("renaming a status reaches every note and the settings", async () => {
  const { renameStatusInNotes, renameStatusInSettings } = await import("../src/managers/StatusRenamer");
  const s = await setup();
  const a = await s.task("One", "", "quite");
  const b = await s.task("Two", "", "todo");
  const changed = await renameStatusInNotes(s.app as never, s.workspaces, "quite", "quit");
  await settle();
  assert.equal(changed, 1);
  assert.equal(s.fm(a).status, "quit");
  assert.equal(s.fm(b).status, "todo");

  const settings = {
    statuses: ["todo", "quite", "quit"],
    closedStatuses: ["done", "quite"],
    collapsedColumns: { "tasks:quite": true },
  } as never as import("../src/types").ProjectManagerSettings;
  renameStatusInSettings(settings, "quite", "quit");
  assert.deepEqual(settings.statuses, ["todo", "quit"]);
  assert.deepEqual(settings.closedStatuses, ["done", "quit"]);
  assert.deepEqual(settings.collapsedColumns, { "tasks:quit": true });
});
