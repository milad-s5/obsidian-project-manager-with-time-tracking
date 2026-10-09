// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Forest — the dashboard's forest, worked out from the vault's data    ║
// ║  Nothing here is saved: a finished task is a tree, its project a     ║
// ║  grove, and where everything stands follows from names alone, so     ║
// ║  the same tasks always grow the same forest. Kept free of Obsidian   ║
// ║  so it can be tested; the drawing lives in views/ForestScene.ts.     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { DONE_STATUS, isClosedStatus, normalizeStatus } from "./StatusColors";
import { addDays } from "./Jalali";
import type { CalendarKind } from "./Calendar";

export type TreeKind = "sprout" | "sapling" | "young" | "old";
export type Species = "round" | "pine" | "blossom";
export type Season = "spring" | "summer" | "autumn" | "winter";
/**
 * active and idle are open projects, idle ones untouched for a few weeks;
 * finished and stopped go to the old forest; the meadow holds small
 * projects once there are many; loose is the tasks with no project.
 */
export type GroveState = "active" | "idle" | "finished" | "stopped" | "meadow" | "loose";

/** A task as the forest needs it */
export interface ForestTaskInput {
  slug: string;
  title: string;
  path: string;
  status: string;
  projectSlug: string;
  totalHours: number;
  /** The day a done task was finished */
  completed: string;
  pomodoros: number;
}

export interface ForestInput {
  tasks: ForestTaskInput[];
  projects: { slug: string; title: string; status: string }[];
  /** Every logged stretch of time, of all periods */
  records: { iso: string; taskSlug: string }[];
  /** The period shown, both ends included; `to` never past today */
  from: string;
  to: string;
  today: string;
  pinned: (projectSlug: string) => boolean;
}

export interface ForestTree {
  slug: string;
  title: string;
  path: string;
  projectSlug: string;
  kind: TreeKind;
  species: Species;
  hours: number;
  /** Empty for a sprout */
  completed: string;
}

export interface Grove {
  /** The project's slug, or "~meadow" / "~loose" */
  key: string;
  title: string;
  state: GroveState;
  pinned: boolean;
  /** Biggest first, sprouts last */
  trees: ForestTree[];
  hours: number;
  flowers: number;
  /** The last day anything happened in the project, of all periods */
  lastActive: string;
  /** For the meadow: the projects it holds */
  members: string[];
}

export interface Forest {
  /** Open projects: pinned first, then by how recently they were worked on */
  groves: Grove[];
  /** Finished and stopped projects */
  old: Grove[];
  /** Tasks with no project, if there are any */
  loose: Grove | null;
  planted: number;
  sprouts: number;
  hours: number;
}

/** A project untouched this long counts as idle */
export const IDLE_DAYS = 21;
/** Past this many groves, the small ones share a meadow */
export const MEADOW_AFTER = 15;
/** A grove this small, or smaller, goes to the meadow */
export const MEADOW_MAX_TREES = 2;
/** The most trees one grove draws; the rest are counted on its label */
export const GROVE_MAX_TREES = 60;
/** The most trees the whole scene draws */
export const SCENE_MAX_TREES = 600;

const MEADOW_KEY = "~meadow";
const LOOSE_KEY = "~loose";

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A repeatable stream of numbers in [0, 1) */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How big a finished task's tree is, by the hours put into it */
export function treeKind(hours: number): TreeKind {
  if (hours > 5) return "old";
  if (hours >= 1) return "young";
  return "sapling";
}

/** Which tree a task grows, the same every time */
export function speciesOf(slug: string): Species {
  const n = hashString(slug) % 100;
  return n < 60 ? "round" : n < 85 ? "pine" : "blossom";
}

/**
 * The season a month falls in, the month being the calendar's own. A
 * Jalali year's quarters are its seasons; a Gregorian one goes by the
 * usual months, spring being March to May.
 */
export function seasonOf(month: number, kind: CalendarKind): Season {
  const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
  const index = kind === "jalali" ? Math.floor((month - 1) / 3) : Math.floor(((month + 9) % 12) / 3);
  return SEASONS[index];
}

export function buildForest(input: ForestInput): Forest {
  const { from, to, today } = input;
  const inPeriod = (iso: string) => iso >= from && iso <= to;

  const lastLogged = new Map<string, string>();
  const loggedInPeriod = new Set<string>();
  for (const r of input.records) {
    if ((lastLogged.get(r.taskSlug) ?? "") < r.iso) lastLogged.set(r.taskSlug, r.iso);
    if (inPeriod(r.iso)) loggedInPeriod.add(r.taskSlug);
  }

  const byProject = new Map<string, { trees: ForestTree[]; flowers: number; lastActive: string }>();
  const bucket = (slug: string) => {
    let b = byProject.get(slug);
    if (!b) byProject.set(slug, (b = { trees: [], flowers: 0, lastActive: "" }));
    return b;
  };

  for (const t of input.tasks) {
    const status = normalizeStatus(t.status);
    const last = [lastLogged.get(t.slug) ?? "", t.completed].sort().pop() ?? "";
    const b = bucket(t.projectSlug);
    if (last > b.lastActive) b.lastActive = last;

    let kind: TreeKind | null = null;
    if (status === DONE_STATUS) {
      if (t.completed && inPeriod(t.completed)) kind = treeKind(t.totalHours);
    } else if (!isClosedStatus(status) && loggedInPeriod.has(t.slug)) {
      // Taken on, or still in the backlog, but worked on in the period
      kind = "sprout";
    }
    if (!kind) continue;
    b.trees.push({
      slug: t.slug,
      title: t.title,
      path: t.path,
      projectSlug: t.projectSlug,
      kind,
      species: speciesOf(t.slug),
      hours: t.totalHours,
      completed: kind === "sprout" ? "" : t.completed,
    });
    b.flowers += Math.max(0, Math.floor(t.pomodoros || 0));
  }

  const projects = new Map(input.projects.map((p) => [p.slug, p]));
  const idleBefore = addDays(today, -IDLE_DAYS);
  const living: Grove[] = [];
  const old: Grove[] = [];
  let loose: Grove | null = null;
  let planted = 0;
  let sprouts = 0;
  let hours = 0;

  for (const [slug, b] of byProject) {
    if (!b.trees.length) continue;
    b.trees.sort(byTreeSize);
    for (const tree of b.trees) {
      if (tree.kind === "sprout") sprouts++;
      else planted++;
      hours += tree.hours;
    }
    const grove: Grove = {
      key: slug || LOOSE_KEY,
      title: slug ? projects.get(slug)?.title ?? slug : "No project",
      state: "active",
      pinned: !!slug && input.pinned(slug),
      trees: b.trees,
      hours: round2(b.trees.reduce((s, t) => s + t.hours, 0)),
      flowers: b.flowers,
      lastActive: b.lastActive,
      members: [],
    };
    if (!slug) {
      grove.state = "loose";
      loose = grove;
      continue;
    }
    const status = normalizeStatus(projects.get(slug)?.status ?? "");
    if (status === DONE_STATUS) grove.state = "finished";
    else if (isClosedStatus(status)) grove.state = "stopped";
    else if (b.lastActive < idleBefore) grove.state = "idle";
    (grove.state === "finished" || grove.state === "stopped" ? old : living).push(grove);
  }

  living.sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) ||
    Number(a.state === "idle") - Number(b.state === "idle") ||
    cmpDesc(a.lastActive, b.lastActive) ||
    a.title.localeCompare(b.title)
  );
  old.sort((a, b) => cmpDesc(a.lastActive, b.lastActive) || a.title.localeCompare(b.title));

  return { groves: gatherMeadow(living), old, loose, planted, sprouts, hours: round2(hours) };
}

/** With many groves, the small ones are put together at the end */
function gatherMeadow(groves: Grove[]): Grove[] {
  if (groves.length <= MEADOW_AFTER) return groves;
  const small = groves.filter((g) => !g.pinned && g.trees.length <= MEADOW_MAX_TREES);
  if (small.length < 2) return groves;
  const meadow: Grove = {
    key: MEADOW_KEY,
    title: "Meadow",
    state: "meadow",
    pinned: false,
    trees: small.flatMap((g) => g.trees).sort(byTreeSize),
    hours: round2(small.reduce((s, g) => s + g.hours, 0)),
    flowers: small.reduce((s, g) => s + g.flowers, 0),
    lastActive: small.map((g) => g.lastActive).sort().pop() ?? "",
    members: small.map((g) => g.title),
  };
  return [...groves.filter((g) => !small.includes(g)), meadow];
}

const KIND_ORDER: Record<TreeKind, number> = { old: 0, young: 1, sapling: 2, sprout: 3 };
function byTreeSize(a: ForestTree, b: ForestTree): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.hours - a.hours || a.slug.localeCompare(b.slug);
}
function cmpDesc(a: string, b: string): number { return a < b ? 1 : a > b ? -1 : 0; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

// ══════════════════════════════════════════════════════════════════════
//  Layout: where each grove and tree stands on the scene
// ══════════════════════════════════════════════════════════════════════

export interface PlacedTree { tree: ForestTree; x: number; y: number; scale: number }
export interface Flower { x: number; y: number; tint: number }
/** Bushes, tufts of grass and stones, so the land is not bare */
export interface Decor { x: number; y: number; size: number; kind: "bush" | "tuft" | "stone" }

export interface PlacedGrove {
  grove: Grove;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Top of the label under the grove, and how wide it may grow */
  labelY: number;
  labelW: number;
  scale: number;
  trees: PlacedTree[];
  /** Trees in the grove not drawn, past the cap */
  hidden: number;
  flowers: Flower[];
  decor: Decor[];
  /** Where a finished project's cabin stands */
  cabin: { x: number; y: number } | null;
}

export interface ForestLayout {
  width: number;
  height: number;
  /** Where the sky meets the land */
  horizon: number;
  /** The road's line across the land, as points */
  road: { x: number; y: number }[];
  /** Tasks with no project, by the road */
  loose: PlacedTree[];
  looseHidden: number;
  groves: PlacedGrove[];
  /** Bushes and grass on the open land between the groves */
  wild: Decor[];
  /** Top of the old forest, when there is one */
  oldTop: number | null;
}

export const HORIZON = 120;
/** Trees are drawn this much bigger than their base size */
export const TREE_SCALE = 1.45;
const ROAD_BAND = 76;
const LABEL_H = 44;
const ROW_GAP = 10;
const OLD_HEADER = 44;
const OLD_SCALE = 0.85;
const CELL_MIN = 240;
const FLOWERS_MAX = 50;
const WILD_MAX = 140;
/** Bushes and grass inside all the groves together */
const DECOR_MAX = 240;

/** How much room a tree takes on the ground, before scaling */
export function treeRadius(tree: ForestTree): number {
  if (tree.kind === "old") return tree.species === "pine" ? 15 : 19;
  if (tree.kind === "young") return 11;
  if (tree.kind === "sapling") return 8;
  return 6;
}

/** How far a tree reaches up from where it stands, before scaling */
export function treeHeight(tree: ForestTree): number {
  if (tree.kind === "old") return tree.species === "pine" ? 50 : 54;
  if (tree.kind === "young") return tree.species === "pine" ? 36 : 32;
  if (tree.kind === "sapling") return tree.species === "pine" ? 26 : 22;
  return 13;
}

export function layoutForest(forest: Forest, width: number, rtl = false): ForestLayout {
  const w = Math.max(320, Math.round(width));
  const cols = Math.max(1, Math.min(4, Math.floor(w / CELL_MIN)));
  const groveCount = forest.groves.length + forest.old.length;
  // Fewer trees each when there are many groves, so the scene stays light
  const cap = Math.max(12, Math.min(GROVE_MAX_TREES, Math.floor(SCENE_MAX_TREES / Math.max(1, groveCount))));
  const decorCap = Math.max(2, Math.min(14, Math.floor(DECOR_MAX / Math.max(1, groveCount))));

  const roadY = HORIZON + 30;
  const road: { x: number; y: number }[] = [];
  for (let i = 0; i <= 32; i++) {
    const x = -20 + ((w + 40) * i) / 32;
    road.push({ x, y: roadAt(x, w, roadY) });
  }

  const loose: PlacedTree[] = [];
  let looseHidden = 0;
  if (forest.loose) {
    // Clear of the words at the road's start
    const start = w > 700 ? 280 : 170;
    const room = Math.max(4, Math.floor((w - start - 10) / 34));
    const shown = forest.loose.trees.slice(0, room);
    looseHidden = forest.loose.trees.length - shown.length;
    const rnd = seeded(hashString(LOOSE_KEY));
    shown.forEach((tree, i) => {
      const x = start + ((i + 0.5) * (w - start - 10)) / shown.length + (rnd() - 0.5) * 10;
      const above = i % 2 === 0;
      loose.push({ tree, x: mirror(x, w, rtl), y: roadAt(x, w, roadY) + (above ? -13 : 28), scale: TREE_SCALE * (above ? 0.85 : 1) });
    });
    loose.sort((a, b) => a.y - b.y);
  }

  const groves: PlacedGrove[] = [];
  let y = HORIZON + ROAD_BAND;
  const placeRows = (list: Grove[], scale: number) => {
    for (let start = 0; start < list.length; start += cols) {
      const row = list.slice(start, start + cols);
      // A last row that is not full is spread over the width
      const slotW = w / row.length;
      const sizes = row.map((g) => groveSize(g.trees.slice(0, cap), slotW, scale));
      const maxRy = Math.max(...sizes.map((s) => s.ry));
      // Room above for the tallest tree that stands near the back
      const reach = Math.max(...row.map((g) => Math.max(0, ...g.trees.slice(0, cap).map((t) => treeHeight(t))))) * TREE_SCALE * scale;
      const centre = y + Math.max(16, reach * 0.75) + maxRy;
      row.forEach((grove, i) => {
        const rnd = seeded(hashString(grove.key) ^ 0x5bd1e995);
        const { rx, ry } = sizes[i];
        const slack = Math.max(0, slotW / 2 - rx - 14);
        const cx = mirror(slotW * i + slotW / 2 + (rnd() - 0.5) * slack, w, rtl);
        const cy = centre + (rnd() - 0.5) * Math.max(0, maxRy - ry);
        groves.push({ ...placeGrove(grove, cx, cy, rx, ry, scale, cap, decorCap), labelW: Math.max(140, slotW - 8) });
      });
      y = centre + maxRy + LABEL_H + ROW_GAP;
    }
  };

  placeRows(forest.groves, 1);
  let oldTop: number | null = null;
  if (forest.old.length) {
    oldTop = y;
    y += OLD_HEADER;
    placeRows(forest.old, OLD_SCALE);
  }
  const height = Math.max(y + 16, HORIZON + ROAD_BAND + 160);

  return {
    width: w, height, horizon: HORIZON, road, loose, looseHidden, groves,
    wild: scatterWild(w, height, roadY, groves, oldTop),
    oldTop,
  };
}

function roadAt(x: number, w: number, base: number): number {
  return base + 12 * Math.sin((x / w) * Math.PI * 3);
}

function mirror(x: number, w: number, rtl: boolean): number {
  return rtl ? w - x : x;
}

/** Big enough to hold its trees with a little room, and no bigger */
function groveSize(trees: ForestTree[], cellW: number, scale: number): { rx: number; ry: number } {
  const room = trees.reduce((sum, t) => sum + (treeRadius(t) * TREE_SCALE * 2.1) ** 2, 0);
  const rx = Math.min(cellW * 0.44, Math.max(58, Math.sqrt(room / (Math.PI * 0.42)) * 1.15 + 18)) * scale;
  return { rx, ry: rx * 0.42 };
}

function placeGrove(
  grove: Grove, cx: number, cy: number, rx: number, ry: number, scale: number, cap: number, decorCap: number
): Omit<PlacedGrove, "labelW"> {
  const rnd = seeded(hashString(grove.key));
  const shown = grove.trees.slice(0, cap);
  const cabin = grove.state === "finished" ? { x: cx + rx * 0.5, y: cy + ry * 0.15 } : null;
  const taken: { x: number; y: number; r: number }[] = cabin ? [{ x: cabin.x, y: cabin.y, r: 26 * scale }] : [];
  const trees: PlacedTree[] = [];
  const s = scale * TREE_SCALE;

  for (const tree of shown) {
    const r = treeRadius(tree) * s;
    let best: { x: number; y: number; gap: number } | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = rnd() * Math.PI * 2;
      // Nearer the middle while there is room, so a few trees stand together
      const d = Math.sqrt(rnd()) * 0.8;
      const x = cx + Math.cos(a) * d * rx;
      const y = cy + Math.sin(a) * d * ry + 4 * scale;
      // How close the nearest tree comes, in units of the room both need
      let gap = Infinity;
      for (const t of taken) gap = Math.min(gap, Math.hypot(t.x - x, (t.y - y) * 1.7) / (t.r + r));
      if (!best || gap > best.gap) best = { x, y, gap };
      if (gap >= 0.85) break;
    }
    if (!best) continue;
    taken.push({ x: best.x, y: best.y, r });
    trees.push({ tree, x: best.x, y: best.y, scale: s * (0.92 + 0.12 * ((best.y - (cy - ry)) / (2 * ry))) });
  }
  // Drawn back to front
  trees.sort((a, b) => a.y - b.y);

  const flowers: Flower[] = [];
  const fr = seeded(hashString(grove.key) ^ 0x2545f491);
  for (let i = 0; i < Math.min(FLOWERS_MAX, grove.flowers); i++) {
    const a = fr() * Math.PI * 2;
    const d = Math.sqrt(fr()) * 0.94;
    flowers.push({ x: cx + Math.cos(a) * d * rx, y: cy + Math.sin(a) * d * ry, tint: i % 4 });
  }

  // Bushes and grass in the gaps between the trees
  const decor: Decor[] = [];
  const dr = seeded(hashString(grove.key) ^ 0x68e31da4);
  const want = Math.min(decorCap, Math.round((rx * ry) / 900));
  for (let i = 0, tries = 0; decor.length < want && tries < want * 8; tries++) {
    const a = dr() * Math.PI * 2;
    const d = 0.25 + Math.sqrt(dr()) * 0.65;
    const x = cx + Math.cos(a) * d * rx;
    const y = cy + Math.sin(a) * d * ry;
    if (taken.some((t) => Math.hypot(t.x - x, (t.y - y) * 1.7) < t.r + 8 * scale)) continue;
    decor.push({ x, y, size: scale * (0.8 + dr() * 0.5), kind: i++ % 3 === 0 ? "bush" : "tuft" });
  }

  return { grove, cx, cy, rx, ry, labelY: cy + ry + 8, scale, trees, hidden: grove.trees.length - shown.length, flowers, decor, cabin };
}

/** Grass, bushes and stones over the open land, clear of groves and their names */
function scatterWild(w: number, h: number, roadY: number, groves: PlacedGrove[], oldTop: number | null): Decor[] {
  const rnd = seeded(0x1b873593);
  const top = roadY + 26;
  const want = Math.min(WILD_MAX, Math.round((w * (h - top)) / 7000));
  const out: Decor[] = [];
  for (let tries = 0; out.length < want && tries < want * 6; tries++) {
    const x = 8 + rnd() * (w - 16);
    const y = top + rnd() * (h - top - 8);
    const size = 0.7 + rnd() * 0.6;
    if (oldTop !== null && Math.abs(y - oldTop) < 40) continue;
    const blocked = groves.some((g) => {
      const dx = (x - g.cx) / (g.rx + 16);
      const dy = (y - g.cy) / (g.ry + 14);
      const inLabel = Math.abs(x - g.cx) < Math.max(90, g.rx) && y > g.labelY - 6 && y < g.labelY + 46;
      const underTrees = Math.abs(x - g.cx) < g.rx && y < g.cy && y > g.cy - g.ry - 60 * g.scale;
      return dx * dx + dy * dy < 1 || inLabel || underTrees;
    });
    if (blocked) continue;
    const r = rnd();
    out.push({ x, y, size, kind: r < 0.62 ? "tuft" : r < 0.88 ? "bush" : "stone" });
  }
  return out.sort((a, b) => a.y - b.y);
}
