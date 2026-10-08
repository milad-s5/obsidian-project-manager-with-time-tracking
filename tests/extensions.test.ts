import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "./helpers";
import { PmEvents, StatusChange, StatusWatcher, TimeLogged } from "../src/core/Extensions";
import { TFile } from "./obsidian";
import { setupCompletedDate } from "../src/features/completedDate";
import { todayISO } from "../src/utils/Jalali";

test("every status change becomes one event, whoever made it", async () => {
  const s = await setup();
  const events = new PmEvents();
  const seen: StatusChange[] = [];
  events.on("status-changed", (c) => { seen.push(c); });
  const watcher = new StatusWatcher(s.app as never, events, () => s.ws);
  s.app.metadataCache.on("changed", (f: TFile) => watcher.onChanged(f as never));
  watcher.seed();

  const t = await s.task("Write", "", "todo");
  await s.app.fileManager.processFrontMatter(t, (fm) => { fm.status = "active"; });
  await settle();
  await s.app.fileManager.processFrontMatter(t, (fm) => { fm.priority = "high"; });
  await settle();
  assert.deepEqual(seen.map((c) => [c.from, c.to, c.created]), [[null, "todo", true], ["todo", "active", false]]);
});

test("logged time is reported, timer and manual alike", async () => {
  const s = await setup();
  const logged: TimeLogged[] = [];
  s.tracker.setLoggedHandler((e) => logged.push(e));
  const t = await s.task("Log me");
  await s.tracker.addManualEntry(s.ws, t as never, 1, "2026-09-01");
  s.tracker.startTimer(t.path, "Log me", s.ws.id);
  s.backdate(30);
  await s.tracker.stopTimer(s.ws);
  assert.deepEqual(logged.map((e) => [e.source, e.hours, e.taskSlug, !!e.entryFile]), [["manual", 1, "log-me", true], ["timer", 0.5, "log-me", true]]);
});

test("moving a task to done fills its end date, reopening it empties it", async () => {
  const s = await setup();
  const events = new PmEvents();
  const watcher = new StatusWatcher(s.app as never, events, () => s.ws);
  s.app.metadataCache.on("changed", (f: TFile) => watcher.onChanged(f as never));
  watcher.seed();
  setupCompletedDate({ app: s.app, events, registerEvent: () => undefined } as never);

  const t = await s.task("Ship", "", "todo");
  await settle();
  const wait = async () => { await settle(); await new Promise((r) => setTimeout(r, 900)); await settle(); };
  await s.app.fileManager.processFrontMatter(t, (fm) => { fm.status = "done"; });
  await wait();
  const fm = () => s.app.metadataCache.getFileCache(t)?.frontmatter ?? {};
  assert.equal(fm().end, todayISO());
  const data = await s.analytics.collect(s.ws);
  assert.equal(data.tasks.find((x) => x.slug === t.basename)?.completed, todayISO());

  await s.app.fileManager.processFrontMatter(t, (fm) => { fm.status = "active"; });
  await wait();
  assert.equal(fm().end, "");
});

test("a task closed before the date was kept counts as done on its last logged day", async () => {
  const s = await setup();
  const t = await s.task("Old", "", "done");
  await s.tracker.addManualEntry(s.ws, t as never, 1, "2026-09-03");
  await s.tracker.addManualEntry(s.ws, t as never, 1, "2026-09-01");
  await settle();
  const data = await s.analytics.collect(s.ws);
  assert.equal(data.tasks.find((x) => x.slug === t.basename)?.completed, "2026-09-03");
});
