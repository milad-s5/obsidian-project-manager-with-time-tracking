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
  assert.deepEqual(listProjectOptions(s.app as never, s.ws), [{ slug: "launch", title: "Launch", status: "done", priority: "medium" }]);
});

test("a new task never shares its note name with an archived one", async () => {
  const s = await setup();
  const first = await s.task("Weekly review");
  await s.tracker.addManualEntry(s.ws, first as never, 2, "2026-09-01");
  await s.app.fileManager.processFrontMatter(first, (fm) => { fm.status = "done"; fm.project = "[[alpha]]"; });
  await settle();
  await s.archive.syncTask(s.ws, first as never);
  await settle();

  const second = await s.taskManager.createTask(s.ws, "Weekly review", "beta", "active", "medium", "");
  await settle();
  assert.equal(second.path, "Work/Tasks/weekly-review-2.md");
  const data = await s.analytics.collect(s.ws);
  assert.deepEqual(data.records.map((r) => [r.taskSlug, r.projectSlug]), [["weekly-review", "alpha"]]);
});

test("a project title with quotes keeps valid frontmatter", async () => {
  const s = await setup();
  const p = await s.projectManager.createProject(s.ws, 'The "Big" Launch', "todo", "medium", "");
  await settle();
  assert.equal(s.fm(p as never).title, 'The "Big" Launch');
  assert.equal(s.fm(p as never).type, "project");
});

test("two projects of the same name both get saved", async () => {
  const s = await setup();
  await s.projectManager.createProject(s.ws, "Website", "todo", "medium", "");
  const second = await s.projectManager.createProject(s.ws, "Website", "todo", "medium", "");
  assert.equal(second.path, "Work/Projects/website-2.md");
});

test("titles in any script make a file name", async () => {
  const s = await setup();
  const ru = await s.projectManager.createProject(s.ws, "Проект", "todo", "medium", "");
  const dots = await s.projectManager.createProject(s.ws, "???", "todo", "medium", "");
  assert.equal(ru.path, "Work/Projects/проект.md");
  assert.equal(dots.path, "Work/Projects/project.md");
});

test("renaming a workspace carries its notes along", async () => {
  const s = await setup();
  await s.task("Keep me");
  await s.projectManager.createProject(s.ws, "Site", "active", "medium", "");
  await settle();
  const updated = await s.workspaceManager.renameWorkspace(s.ws, "Office");
  await settle();
  assert.equal(updated, 2);
  assert.equal(s.ws.name, "Office");
  assert.equal((await s.taskManager.getTasks(s.ws)).length, 1);
  assert.equal((await s.projectManager.getProjects(s.ws)).length, 1);
});
