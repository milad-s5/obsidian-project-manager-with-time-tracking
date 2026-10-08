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
