import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectFacts, projectRanking } from "../src/views/ProjectGroups";

const facts: ProjectFacts[] = [
  { slug: "", title: "", pinned: false, lastActive: 900, priority: 3, open: 9 },
  { slug: "blog", title: "Blog", pinned: false, lastActive: 100, priority: 3, open: 1 },
  { slug: "app", title: "App", pinned: false, lastActive: 300, priority: 1, open: 5 },
  { slug: "site", title: "Site", pinned: true, lastActive: 50, priority: 0, open: 0 },
  { slug: "zine", title: "Zine", pinned: false, lastActive: 300, priority: 1, open: 2 },
];
const order = (o: Parameters<typeof projectRanking>[1]) =>
  [...projectRanking(facts, o).entries()].sort((a, b) => a[1] - b[1]).map(([slug]) => slug);

test("pinned projects lead, no project trails, the rest follow the chosen order", () => {
  assert.deepEqual(order("activity"), ["site", "app", "zine", "blog", ""]);
  assert.deepEqual(order("priority"), ["site", "blog", "app", "zine", ""]);
  assert.deepEqual(order("open"), ["site", "app", "zine", "blog", ""]);
  assert.deepEqual(order("name"), ["site", "app", "blog", "zine", ""]);
});
