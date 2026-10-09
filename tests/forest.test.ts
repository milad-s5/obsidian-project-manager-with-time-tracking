import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ForestInput, ForestTaskInput, GROVE_MAX_TREES, MEADOW_AFTER, SCENE_MAX_TREES,
  buildForest, layoutForest, seasonOf, treeKind, treeRadius,
} from "../src/utils/Forest";

const TODAY = "2026-10-09";

function task(slug: string, over: Partial<ForestTaskInput> = {}): ForestTaskInput {
  return {
    slug, title: slug, path: `Tasks/${slug}.md`, status: "done", projectSlug: "site",
    totalHours: 2, completed: "2026-10-05", pomodoros: 0, ...over,
  };
}

function input(tasks: ForestTaskInput[], over: Partial<ForestInput> = {}): ForestInput {
  return {
    tasks,
    projects: [
      { slug: "site", title: "Website", status: "active" },
      { slug: "app", title: "App", status: "done" },
      { slug: "old", title: "Old plan", status: "cancel" },
    ],
    records: [],
    from: "2026-10-01",
    to: TODAY,
    today: TODAY,
    pinned: () => false,
    ...over,
  };
}

test("a tree's size follows the hours put into the task", () => {
  assert.equal(treeKind(0), "sapling");
  assert.equal(treeKind(0.99), "sapling");
  assert.equal(treeKind(1), "young");
  assert.equal(treeKind(5), "young");
  assert.equal(treeKind(5.01), "old");
});

test("only tasks finished in the period are trees; open ones worked on are sprouts", () => {
  const forest = buildForest(input(
    [
      task("in", {}),
      task("before", { completed: "2026-09-20" }),
      task("cancelled", { status: "cancel", completed: "" }),
      task("open", { status: "doing", completed: "" }),
      task("idle-open", { status: "doing", completed: "" }),
      task("backlog", { status: "backlog", completed: "" }),
    ],
    { records: [{ iso: "2026-10-02", taskSlug: "open" }, { iso: "2026-09-02", taskSlug: "idle-open" }, { iso: "2026-10-03", taskSlug: "backlog" }] }
  ));
  const site = forest.groves.find((g) => g.key === "site");
  assert.ok(site);
  assert.deepEqual(site.trees.map((t) => [t.slug, t.kind]), [["in", "young"], ["backlog", "sprout"], ["open", "sprout"]]);
  assert.equal(forest.planted, 1);
  assert.equal(forest.sprouts, 2);
});

test("finished and cancelled projects go to the old forest; tasks with no project stand apart", () => {
  const forest = buildForest(input([
    task("a"),
    task("b", { projectSlug: "app" }),
    task("c", { projectSlug: "old" }),
    task("d", { projectSlug: "" }),
  ]));
  assert.deepEqual(forest.groves.map((g) => g.key), ["site"]);
  assert.deepEqual(forest.old.map((g) => [g.key, g.state]).sort(), [["app", "finished"], ["old", "stopped"]]);
  assert.equal(forest.loose?.title, "No project");
  assert.equal(forest.loose?.trees.length, 1);
});

test("an open project untouched for three weeks is idle, and waits behind the active ones", () => {
  const forest = buildForest(input(
    [task("x", { completed: "2026-08-01" }), task("y", { projectSlug: "blog", completed: "2026-10-08" })],
    {
      from: "2026-01-01",
      projects: [{ slug: "site", title: "Website", status: "active" }, { slug: "blog", title: "Blog", status: "active" }],
    }
  ));
  assert.deepEqual(forest.groves.map((g) => [g.key, g.state]), [["blog", "active"], ["site", "idle"]]);
});

test("pinned projects lead the forest", () => {
  const forest = buildForest(input(
    [task("x", { completed: "2026-10-01" }), task("y", { projectSlug: "blog", completed: "2026-10-08" })],
    {
      projects: [{ slug: "site", title: "Website", status: "active" }, { slug: "blog", title: "Blog", status: "active" }],
      pinned: (slug) => slug === "site",
    }
  ));
  assert.deepEqual(forest.groves.map((g) => g.key), ["site", "blog"]);
  assert.equal(forest.groves[0].pinned, true);
});

test("past fifteen groves the small ones share a meadow", () => {
  const tasks: ForestTaskInput[] = [];
  const projects = [];
  for (let i = 0; i < MEADOW_AFTER + 4; i++) {
    const slug = `p${i}`;
    projects.push({ slug, title: `Project ${i}`, status: "active" });
    const size = i < 10 ? 4 : 1;
    for (let j = 0; j < size; j++) tasks.push(task(`${slug}-${j}`, { projectSlug: slug }));
  }
  const forest = buildForest(input(tasks, { projects }));
  assert.equal(forest.groves.length, 11);
  const meadow = forest.groves[forest.groves.length - 1];
  assert.equal(meadow.state, "meadow");
  assert.equal(meadow.members.length, MEADOW_AFTER + 4 - 10);
  assert.equal(meadow.trees.length, MEADOW_AFTER + 4 - 10);
});

test("flowers count the pomodoros of the grove's trees", () => {
  const forest = buildForest(input([task("a", { pomodoros: 3 }), task("b", { pomodoros: 2.7 }), task("c", { completed: "2025-01-01", pomodoros: 9 })]));
  assert.equal(forest.groves[0].flowers, 5);
});

test("seasons follow the chosen calendar", () => {
  // Jalali quarters are the seasons
  assert.equal(seasonOf(1, "jalali"), "spring");
  assert.equal(seasonOf(4, "jalali"), "summer");
  assert.equal(seasonOf(7, "jalali"), "autumn");
  assert.equal(seasonOf(12, "jalali"), "winter");
  // Gregorian: March to May is spring, December to February winter
  assert.equal(seasonOf(3, "gregorian"), "spring");
  assert.equal(seasonOf(6, "gregorian"), "summer");
  assert.equal(seasonOf(10, "gregorian"), "autumn");
  assert.equal(seasonOf(12, "gregorian"), "winter");
  assert.equal(seasonOf(2, "gregorian"), "winter");
});

function bigForest(projects: number, perProject: number) {
  const tasks: ForestTaskInput[] = [];
  const list = [];
  for (let i = 0; i < projects; i++) {
    const slug = `project-${i}`;
    list.push({ slug, title: `Project ${i}`, status: i % 5 === 0 ? "done" : "active" });
    for (let j = 0; j < perProject; j++) tasks.push(task(`${slug}-task-${j}`, { projectSlug: slug, totalHours: (j % 9) * 0.8 }));
  }
  for (let j = 0; j < 30; j++) tasks.push(task(`loose-${j}`, { projectSlug: "" }));
  return buildForest(input(tasks, { projects: list }));
}

test("groves never overlap, and their trees stay on them", () => {
  for (const width of [360, 700, 1200]) {
    for (const rtl of [false, true]) {
      const layout = layoutForest(bigForest(12, 25), width, rtl);
      const boxes = layout.groves.map((g) => ({ l: g.cx - g.rx, r: g.cx + g.rx, t: g.cy - g.ry, b: g.labelY + 20 }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const apart = a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
          assert.ok(apart, `groves ${i} and ${j} overlap at width ${width}`);
        }
      }
      for (const g of layout.groves) {
        assert.ok(g.cx - g.rx >= 0 && g.cx + g.rx <= layout.width, "grove inside the scene");
        for (const t of g.trees) {
          const dx = (t.x - g.cx) / g.rx;
          const dy = (t.y - g.cy - 4 * g.scale) / g.ry;
          assert.ok(dx * dx + dy * dy <= 1, "tree on its grove");
        }
      }
      assert.ok(layout.height > layout.groves[layout.groves.length - 1].labelY);
    }
  }
});

test("bushes and grass keep off the groves and their names", () => {
  const layout = layoutForest(bigForest(9, 6), 900);
  assert.ok(layout.wild.length > 20, `some scenery (${layout.wild.length})`);
  for (const d of layout.wild) {
    for (const g of layout.groves) {
      const dx = (d.x - g.cx) / g.rx;
      const dy = (d.y - g.cy) / g.ry;
      assert.ok(dx * dx + dy * dy >= 1, "not on a grove");
      assert.ok(!(Math.abs(d.x - g.cx) < 80 && d.y > g.labelY && d.y < g.labelY + 36), "not on a name");
    }
  }
});

test("a lot of work still draws a light scene", () => {
  const forest = bigForest(40, 80);
  const layout = layoutForest(forest, 1000);
  const drawn = layout.groves.reduce((s, g) => s + g.trees.length, 0) + layout.loose.length;
  assert.ok(drawn <= SCENE_MAX_TREES + layout.loose.length, `${drawn} trees drawn`);
  for (const g of layout.groves) {
    assert.ok(g.trees.length <= GROVE_MAX_TREES);
    assert.equal(g.trees.length + g.hidden, g.grove.trees.length, "the rest are counted");
  }
  assert.ok(layout.oldTop !== null, "finished projects get the old forest");
  const old = layout.groves.filter((g) => g.grove.state === "finished");
  assert.ok(old.every((g) => g.cy > (layout.oldTop ?? 0)), "below the old forest line");
});

test("the same tasks always grow the same forest, mirrored right to left", () => {
  const a = layoutForest(bigForest(5, 10), 900);
  const b = layoutForest(bigForest(5, 10), 900);
  assert.deepEqual(a, b);
  const r = layoutForest(bigForest(5, 10), 900, true);
  a.groves.forEach((g, i) => assert.equal(Math.round(r.groves[i].cx), Math.round(900 - g.cx)));
});

test("a tree's room on the ground grows with it", () => {
  const t = (kind: "sprout" | "sapling" | "young" | "old") => treeRadius({ kind, species: "round" } as never);
  assert.ok(t("sprout") < t("sapling") && t("sapling") < t("young") && t("young") < t("old"));
});
