import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "./helpers";
import { listProjectOptions, matchProject } from "../src/utils/WorkspacePaths";

const options = [
  { slug: "website", title: "Website ", status: "active" },
  { slug: "design-system", title: "Design system", status: "todo" },
];

test("a project is found by title whatever the spaces or case", () => {
  assert.equal(matchProject("Website", options)?.slug, "website");
  assert.equal(matchProject("  design SYSTEM ", options)?.slug, "design-system");
  assert.equal(matchProject("design-system", options)?.slug, "design-system");
  assert.equal(matchProject("Nope", options), null);
  assert.equal(matchProject("   ", options), null);
});

test("archived projects are still listed, with their status", async () => {
  const s = await setup();
  const p = await s.projectManager.createProject(s.ws, "Launch", "active", "medium", "");
  await settle();
  await s.app.fileManager.processFrontMatter(p as never, (fm) => { fm.status = "done"; });
  await settle();
  await s.archive.syncProject(s.ws, p as never);
  await settle();
  assert.match(p.path, /Archive\/Projects/);
  assert.deepEqual(listProjectOptions(s.app as never, s.ws), [{ slug: "launch", title: "Launch", status: "done" }]);
});
