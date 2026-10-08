import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "./helpers";
import { ProjectStatsSync } from "../src/managers/ProjectStatsSync";
import { TFile } from "./obsidian";

async function withSync() {
  const s = await setup();
  const sync = new ProjectStatsSync(s.app as never, s.projectManager, () => s.ws, () => s.ws);
  s.app.metadataCache.on("changed", (f: TFile) => sync.onChanged(f as never));
  s.app.vault.on("delete", (f: TFile) => sync.onDeleted(f.path));
  s.app.vault.on("rename", (f: TFile, old: string) => sync.onRenamed(f.path, old));
  const settleAll = async () => { await settle(); await sync.flush(); await settle(); };
  return { ...s, sync, settleAll };
}

test("logging time updates the project's hours and task count", async () => {
  const s = await withSync();
  const project = await s.projectManager.createProject(s.ws, "Site", "active", "medium", "");
  const a = await s.task("One", "site");
  await s.task("Two", "site", "cancel");
  await s.tracker.addManualEntry(s.ws, a as never, 2.5, "2026-09-01");
  await s.settleAll();
  assert.equal(s.fm(project as never).hours, 2.5);
  assert.equal(s.fm(project as never).task_count, 1, "the cancelled task is left out");
});

test("moving a task to another project recounts both", async () => {
  const s = await withSync();
  const site = await s.projectManager.createProject(s.ws, "Site", "active", "medium", "");
  const app = await s.projectManager.createProject(s.ws, "App", "active", "medium", "");
  const t = await s.task("Shared", "site");
  await s.settleAll();
  assert.equal(s.fm(site as never).task_count, 1);
  await s.app.fileManager.processFrontMatter(t, (fm) => { fm.project = "[[app]]"; });
  await s.settleAll();
  assert.equal(s.fm(site as never).task_count, 0);
  assert.equal(s.fm(app as never).task_count, 1);
});

test("deleting a task recounts its project", async () => {
  const s = await withSync();
  const site = await s.projectManager.createProject(s.ws, "Site", "active", "medium", "");
  const t = await s.task("Doomed", "site");
  await s.settleAll();
  await s.app.vault.delete(t);
  await s.settleAll();
  assert.equal(s.fm(site as never).task_count, 0);
});
