import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "./helpers";
import { createApi } from "../src/api";

test("API methods work when taken off the object", async () => {
  const s = await setup();
  const plugin = {
    app: s.app,
    settings: { workspaces: s.workspaces },
    projectManager: s.projectManager,
    taskManager: s.taskManager,
  };
  const { ensureProject, listProjects } = createApi(plugin as never);
  const first = await ensureProject(s.ws.id, { title: "Website" });
  await settle();
  const again = await ensureProject(s.ws.id, { title: "Website" });
  assert.deepEqual(again, first, "the second call finds the first project");
  assert.equal(listProjects(s.ws.id).length, 1);
});
