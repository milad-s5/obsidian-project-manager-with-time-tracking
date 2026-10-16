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
  records: { iso: string; taskSlug: string; hours: number }[];
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
  /**
   * Biggest first, sprouts last. What grew in the period for a project at
   * work; every tree it ever grew for one resting or closed, since its
   * trees stay with it.
   */
  trees: ForestTree[];
  /** Logged in the period */
  hours: number;
  /** Logged on its tasks, all told */
  totalHours: number;
  /** The pomodoros of its trees */
  flowers: number;
  /** The last day anything happened in the project, of all periods */
  lastActive: string;
  /** The tree finished last, if any */
  latest: ForestTree | null;
  /** For the meadow: the projects it holds */
  members: string[];
}

export interface Forest {
  /** Open projects: pinned first, then the ones at work, then the resting */
  groves: Grove[];
  /** Finished and stopped projects, with every tree they grew */
  old: Grove[];
  /** Tasks with no project worked on in the period, if any */
  loose: Grove | null;
  /** Tasks finished in the period, any project or none */
  planted: number;
  /** Open tasks worked on in the period */
  sprouts: number;
  /** Logged in the period */
  hours: number;
  /** Pomodoros of the period's trees and sprouts */
  flowers: number;
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
export const LOOSE_KEY = "~loose";

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

interface ProjectBucket {
  period: ForestTree[];
  ever: ForestTree[];
  hours: number;
  totalHours: number;
  lastActive: string;
  pomodoros: Map<string, number>;
}

export function buildForest(input: ForestInput): Forest {
  const { from, to, today } = input;
  const inPeriod = (iso: string) => iso >= from && iso <= to;

  const lastLogged = new Map<string, string>();
  const periodHours = new Map<string, number>();
  for (const r of input.records) {
    if ((lastLogged.get(r.taskSlug) ?? "") < r.iso) lastLogged.set(r.taskSlug, r.iso);
    if (inPeriod(r.iso)) periodHours.set(r.taskSlug, (periodHours.get(r.taskSlug) ?? 0) + (r.hours || 0));
  }

  const byProject = new Map<string, ProjectBucket>();
  const bucket = (slug: string) => {
    let b = byProject.get(slug);
    if (!b) byProject.set(slug, (b = { period: [], ever: [], hours: 0, totalHours: 0, lastActive: "", pomodoros: new Map() }));
    return b;
  };

  let planted = 0;
  let sprouts = 0;
  let flowers = 0;
  let hours = 0;
  for (const t of input.tasks) {
    const status = normalizeStatus(t.status);
    const b = bucket(t.projectSlug);
    const last = [lastLogged.get(t.slug) ?? "", t.completed].sort().pop() ?? "";
    if (last > b.lastActive) b.lastActive = last;
    const logged = periodHours.get(t.slug) ?? 0;
    b.hours += logged;
    b.totalHours += t.totalHours || 0;
    hours += logged;
    const poms = Math.max(0, Math.floor(t.pomodoros || 0));
    b.pomodoros.set(t.slug, poms);

    const tree = (kind: TreeKind): ForestTree => ({
      slug: t.slug, title: t.title, path: t.path, projectSlug: t.projectSlug,
      kind, species: speciesOf(t.slug), hours: t.totalHours, completed: kind === "sprout" ? "" : t.completed,
    });
    if (status === DONE_STATUS && t.completed) {
      const done = tree(treeKind(t.totalHours));
      b.ever.push(done);
      if (inPeriod(t.completed)) { b.period.push(done); planted++; flowers += poms; }
    } else if (!isClosedStatus(status) && periodHours.has(t.slug)) {
      // Taken on, or still in the backlog, but worked on in the period
      b.period.push(tree("sprout"));
      sprouts++;
      flowers += poms;
    }
  }

  const projects = new Map(input.projects.map((p) => [p.slug, p]));
  const idleBefore = addDays(today, -IDLE_DAYS);
  const living: Grove[] = [];
  const old: Grove[] = [];
  let loose: Grove | null = null;

  for (const [slug, b] of byProject) {
    const status = normalizeStatus(projects.get(slug)?.status ?? "");
    let state: GroveState = "active";
    let trees = b.period;
    if (!slug) state = "loose";
    else if (status === DONE_STATUS) { state = "finished"; trees = b.ever; }
    else if (isClosedStatus(status)) { state = "stopped"; trees = b.ever; }
    else if (b.lastActive < idleBefore && b.ever.length) { state = "idle"; trees = b.ever; }
    if (!trees.length) continue;
    trees.sort(byTreeSize);
    const latest = trees.filter((t) => t.completed).sort((x, y) => cmpDesc(x.completed, y.completed))[0] ?? null;
    const grove: Grove = {
      key: slug || LOOSE_KEY,
      title: slug ? projects.get(slug)?.title ?? slug : "No project",
      state,
      pinned: !!slug && input.pinned(slug),
      trees,
      hours: round2(b.hours),
      totalHours: round2(b.totalHours),
      flowers: trees.reduce((sum, t) => sum + (b.pomodoros.get(t.slug) ?? 0), 0),
      lastActive: b.lastActive,
      latest,
      members: [],
    };
    if (state === "loose") loose = grove;
    else (state === "finished" || state === "stopped" ? old : living).push(grove);
  }

  living.sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) ||
    Number(a.state === "idle") - Number(b.state === "idle") ||
    cmpDesc(a.lastActive, b.lastActive) ||
    a.title.localeCompare(b.title)
  );
  old.sort((a, b) => cmpDesc(a.lastActive, b.lastActive) || a.title.localeCompare(b.title));

  return { groves: gatherMeadow(living), old, loose, planted, sprouts, hours: round2(hours), flowers };
}

/** With many groves, the small ones are put together at the end */
function gatherMeadow(groves: Grove[]): Grove[] {
  if (groves.length <= MEADOW_AFTER) return groves;
  const small = groves.filter((g) => !g.pinned && g.state === "active" && g.trees.length <= MEADOW_MAX_TREES);
  if (small.length < 2) return groves;
  const trees = small.flatMap((g) => g.trees).sort(byTreeSize);
  const meadow: Grove = {
    key: MEADOW_KEY,
    title: "Meadow",
    state: "meadow",
    pinned: false,
    trees,
    hours: round2(small.reduce((s, g) => s + g.hours, 0)),
    totalHours: round2(small.reduce((s, g) => s + g.totalHours, 0)),
    flowers: small.reduce((s, g) => s + g.flowers, 0),
    lastActive: small.map((g) => g.lastActive).sort().pop() ?? "",
    latest: trees.filter((t) => t.completed).sort((x, y) => cmpDesc(x.completed, y.completed))[0] ?? null,
    members: small.map((g) => g.title),
  };
  // Before the resting groves, which close the forest
  const rest = groves.filter((g) => !small.includes(g));
  const at = rest.findIndex((g) => g.state === "idle");
  return at < 0 ? [...rest, meadow] : [...rest.slice(0, at), meadow, ...rest.slice(at)];
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

export type ForestView = "active" | "old";

export interface PlacedTree { tree: ForestTree; x: number; y: number; scale: number }
/** Grass, stones and flowers, so the land is not bare */
export interface Decor { x: number; y: number; size: number; kind: "tuft" | "stone" | "flower" }

export interface PlacedGrove {
  grove: Grove;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Top of the card under the grove, and how wide it may grow */
  labelY: number;
  labelW: number;
  scale: number;
  trees: PlacedTree[];
  /** Trees in the grove not drawn, past the cap */
  hidden: number;
  /** A flower for each pomodoro, and grass between the trees */
  decor: Decor[];
  /** Where a finished project's cabin stands */
  cabin: { x: number; y: number } | null;
}

/** A glimpse of the old forest in a corner of the active one */
export interface OldCorner {
  x: number;
  y: number;
  w: number;
  h: number;
  trees: PlacedTree[];
  cabin: { x: number; y: number } | null;
}

export interface ForestLayout {
  width: number;
  height: number;
  groves: PlacedGrove[];
  /** The road's line, bottom to top, to be drawn smooth */
  road: { x: number; y: number }[];
  /** Tasks with no project, by the road */
  loose: PlacedTree[];
  looseHidden: number;
  /** Where the words about them go */
  looseAt: { x: number; y: number } | null;
  corner: OldCorner | null;
  /** Grass, stones and flowers over the open land */
  wild: Decor[];
}

/** Trees are drawn this much bigger than their base size */
export const TREE_SCALE = 2;
/** Room at the top for the forest's name */
const TOP = 78;
const LABEL_H = 62;
const ROW_GAP = 8;
const CELL_MIN = 270;
const CORNER_H = 236;
const FLOWERS_MAX = 40;
const WILD_MAX = 70;
const ROAD_HALF = 22;

/** How much room a tree takes on the ground, before scaling */
export function treeRadius(tree: ForestTree): number {
  if (tree.kind === "old") return tree.species === "pine" ? 15 : 20;
  if (tree.kind === "young") return tree.species === "pine" ? 11 : 13;
  if (tree.kind === "sapling") return 7;
  return 6;
}

/** How far a tree reaches up from where it stands, before scaling */
export function treeHeight(tree: ForestTree): number {
  if (tree.kind === "old") return tree.species === "pine" ? 56 : 54;
  if (tree.kind === "young") return tree.species === "pine" ? 40 : 36;
  if (tree.kind === "sapling") return 24;
  return 12;
}

export function layoutForest(forest: Forest, width: number, opts: { rtl?: boolean; view?: ForestView } = {}): ForestLayout {
  const rtl = !!opts.rtl;
  const view = opts.view ?? "active";
  const w = Math.max(320, Math.round(width));
  const cols = Math.max(1, Math.min(4, Math.floor(w / CELL_MIN)));
  const slotW = w / cols;
  const list = view === "active" ? forest.groves : forest.old;
  const withCorner = view === "active" && forest.old.length > 0;
  // Fewer trees each when there are many groves, so the scene stays light
  const cap = Math.max(12, Math.min(GROVE_MAX_TREES, Math.floor(SCENE_MAX_TREES / Math.max(1, list.length))));
  const flowerCap = Math.max(4, Math.min(FLOWERS_MAX, Math.floor(400 / Math.max(1, list.length))));
  const X = (x: number) => (rtl ? w - x : x);

  // Rows of slots; the old forest's corner takes the first row's last slot
  type Slot = Grove | "corner";
  const slots: Slot[] = [...list];
  if (withCorner) slots.splice(Math.min(cols - 1, slots.length), 0, "corner");
  if (withCorner && cols === 1) { slots.splice(slots.indexOf("corner"), 1); slots.unshift("corner"); }

  const groves: PlacedGrove[] = [];
  let corner: OldCorner | null = null;
  const rows: { top: number; bottom: number; edges: number[] }[] = [];
  const labelW = Math.max(150, slotW - 12);
  // Groves alone in their row, placed once the road is known
  const lone: { g: Grove; row: number; cx: number; cy: number; rx: number; ry: number }[] = [];
  let y = TOP;
  for (let start = 0; start < slots.length; start += cols) {
    const row = slots.slice(start, start + cols);
    // A last row that is not full stands in the middle
    const offset = (w - row.length * slotW) / 2;
    const groveSlots = row.filter((g): g is Grove => g !== "corner");
    const sizes = new Map(groveSlots.map((g) => [g, groveSize(g.trees.slice(0, cap), slotW)]));
    const maxRy = Math.max(0, ...[...sizes.values()].map((z) => z.ry));
    const reach = Math.max(0, ...groveSlots.map((g) => Math.max(0, ...g.trees.slice(0, cap).map(treeHeight)))) * TREE_SCALE;
    const centre = y + Math.max(20, reach * 0.8) + maxRy;
    let bottom = groveSlots.length ? centre + maxRy + LABEL_H : y;
    row.forEach((g, i) => {
      const left = offset + slotW * i;
      if (g === "corner") {
        corner = placeCorner(forest.old, rtl ? w - left - slotW : left, y, slotW, rtl);
        bottom = Math.max(bottom, y + CORNER_H);
        return;
      }
      const rnd = seeded(hashString(g.key) ^ 0x5bd1e995);
      const { rx, ry } = sizes.get(g) ?? { rx: 60, ry: 25 };
      const cx = X(left + slotW / 2 + (rnd() - 0.5) * slotW * 0.06);
      const cy = centre + (rnd() - 0.5) * Math.max(0, maxRy - ry);
      if (row.length === 1) { lone.push({ g, row: rows.length, cx, cy, rx, ry }); return; }
      groves.push({ ...placeGrove(g, cx, cy, rx, ry, 1, cap, flowerCap), labelW });
    });
    // Where the road may pass this row: between two slots, or beside the row
    const edges: number[] = [];
    for (let i = 0; i <= row.length; i++) edges.push(X(offset + slotW * i));
    rows.push({ top: y, bottom, edges });
    y = bottom + ROW_GAP;
  }
  const height = Math.max(y + 40, TOP + 260);

  const xs = roadXs(rows, w, corner);
  const road = layRoad(rows, xs, w, height, corner);
  // A grove alone in its row has no gap for the road, which passes beside it;
  // the grove steps aside, clear of the road and of the words at its foot
  for (const { g, row, cx, cy, rx, ry } of lone) {
    const away = Math.sign(cx - xs[row]) || (rtl ? -1 : 1);
    const at = xs[row] + away * Math.max(Math.abs(cx - xs[row]), labelW / 2 + ROAD_HALF + 80);
    groves.push({ ...placeGrove(g, Math.min(w - rx - 8, Math.max(rx + 8, at)), cy, rx, ry, 1, cap, flowerCap), labelW });
  }
  const { loose, looseHidden, looseAt } = placeLoose(forest.loose, road, groves, corner, w);
  return {
    width: w, height, groves, road, loose, looseHidden, looseAt, corner,
    wild: scatterWild(w, height, groves, corner, road, loose),
  };
}

/** Big enough to hold its trees with a little room, and no bigger */
function groveSize(trees: ForestTree[], slotW: number): { rx: number; ry: number } {
  const room = trees.reduce((sum, t) => sum + (treeRadius(t) * TREE_SCALE * 2) ** 2, 0);
  // Kept off the slot's edges, which is where the road runs
  const rx = Math.min(slotW * 0.36, Math.max(54, Math.sqrt(room / (Math.PI * 0.45)) * 1.1 + 14));
  return { rx, ry: rx * 0.45 };
}

function placeGrove(
  grove: Grove, cx: number, cy: number, rx: number, ry: number, scale: number, cap: number, flowerCap: number
): Omit<PlacedGrove, "labelW"> {
  const rnd = seeded(hashString(grove.key));
  const shown = grove.trees.slice(0, cap);
  const cabin = grove.state === "finished" ? { x: cx + rx * 0.45, y: cy + ry * 0.1 } : null;
  const taken: { x: number; y: number; r: number }[] = cabin ? [{ x: cabin.x, y: cabin.y, r: 30 * scale }] : [];
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

  const decor: Decor[] = [];
  const dr = seeded(hashString(grove.key) ^ 0x68e31da4);
  const clear = (x: number, y: number) => !taken.some((t) => Math.hypot(t.x - x, (t.y - y) * 1.7) < t.r + 6 * scale);
  const flowers = Math.min(flowerCap, grove.flowers);
  for (let tries = 0; decor.length < flowers && tries < flowers * 10; tries++) {
    const a = dr() * Math.PI * 2;
    const d = Math.sqrt(dr()) * 0.95;
    const x = cx + Math.cos(a) * d * rx;
    const y = cy + Math.sin(a) * d * ry;
    if (clear(x, y)) decor.push({ x, y, size: scale * (0.85 + dr() * 0.3), kind: "flower" });
  }
  const tufts = Math.round((rx * ry) / 2600);
  for (let i = 0, tries = 0; i < tufts && tries < tufts * 8; tries++) {
    const a = dr() * Math.PI * 2;
    const d = 0.3 + Math.sqrt(dr()) * 0.65;
    const x = cx + Math.cos(a) * d * rx;
    const y = cy + Math.sin(a) * d * ry;
    if (!clear(x, y)) continue;
    decor.push({ x, y, size: scale * (0.8 + dr() * 0.4), kind: "tuft" });
    i++;
  }
  decor.sort((a, b) => a.y - b.y);

  return { grove, cx, cy, rx, ry, labelY: cy + ry + 10, scale, trees, hidden: grove.trees.length - shown.length, decor, cabin };
}

/** A few of the old forest's trees round a cabin, in the corner */
function placeCorner(old: Grove[], slotLeft: number, top: number, slotW: number, rtl: boolean): OldCorner {
  const w = Math.min(slotW - 16, 300);
  // In the far corner of its slot
  const x = rtl ? slotLeft + 8 : slotLeft + slotW - w - 8;
  // The biggest tree of each project in turn, then the next biggest
  const picked: ForestTree[] = [];
  for (let round = 0; picked.length < 7 && round < 7; round++) {
    for (const g of old) if (g.trees[round] && picked.length < 7) picked.push(g.trees[round]);
  }
  const fake: Grove = {
    key: "~old", title: "", state: old.some((g) => g.state === "finished") ? "finished" : "stopped",
    pinned: false, trees: picked.sort(byTreeSize), hours: 0, totalHours: 0, flowers: 0, lastActive: "", latest: null, members: [],
  };
  // Below the corner's words, above the list of projects
  const placed = placeGrove(fake, x + w * 0.46, top + 142, w * 0.4, 24, 0.5, 7, 0);
  return { x, y: top, w, h: CORNER_H, trees: placed.trees, cabin: placed.cabin };
}

/**
 * Where the road crosses each row: between two groves where it can,
 * swinging from one gap to the next, and in the top row through the gap
 * beside the old forest. A row of one grove has no gap, so the road passes
 * beside it, on the side nearer where it heads next.
 */
function roadXs(rows: { edges: number[] }[], w: number, corner: OldCorner | null): number[] {
  const fit = (e: number) => Math.min(w * 0.95, Math.max(w * 0.05, e));
  const xs = rows.map((r, i): number | null => {
    const gaps = r.edges.slice(1, -1).map(fit).sort((a, b) => a - b);
    // In the top row it heads for the old forest, beside it or, alone there, into it
    if (i === 0 && corner) return gaps.length ? (corner.x > w / 2 ? gaps[gaps.length - 1] : gaps[0]) : w * 0.5;
    return gaps.length ? gaps[(rows.length - 1 - i) % gaps.length] : null;
  });
  for (let i = 0; i < rows.length; i++) {
    if (xs[i] !== null) continue;
    const edges = rows[i].edges;
    const start = fit(edges[0]);
    const end = fit(edges[edges.length - 1]);
    const next = i > 0 ? xs[i - 1] : xs.find((x) => x !== null);
    xs[i] = next != null && Math.abs(end - next) < Math.abs(start - next) ? end : start;
  }
  return xs as number[];
}

/** The road climbs from the bottom through each row, and ends at the old forest or the top edge */
function layRoad(rows: { top: number; bottom: number; edges: number[] }[], xs: number[], w: number, h: number, corner: OldCorner | null): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = rows.length - 1, turn = 0; i >= 0; i--, turn++) {
    const r = rows[i];
    const x = xs[i];
    const sway = Math.min(16, (r.edges.length > 1 ? Math.abs(r.edges[1] - r.edges[0]) : w) * 0.05) * (turn % 2 ? 1 : -1);
    if (!points.length) points.push({ x: x + sway, y: h + 30 });
    points.push({ x: x + sway, y: r.bottom - 6 }, { x: x - sway, y: r.top + 18 });
  }
  const x = xs.length ? xs[0] : w * 0.46;
  if (!points.length) points.push({ x, y: h + 30 });
  if (corner) points.push({ x: corner.x + corner.w * 0.15, y: corner.y + corner.h * 0.66 }, { x: corner.x + corner.w * 0.5, y: corner.y + corner.h * 0.6 });
  else points.push({ x, y: -30 });
  return points;
}

/** Points along a line every `step` apart, with the way it is heading */
function along(line: { x: number; y: number }[], step: number): { x: number; y: number; dx: number; dy: number }[] {
  const out: { x: number; y: number; dx: number; dy: number }[] = [];
  let carry = step / 2;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    for (let d = carry; d < len; d += step) out.push({ x: a.x + dx * d, y: a.y + dy * d, dx, dy });
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
  return out;
}

function nearRoad(road: { x: number; y: number }[], x: number, y: number, room: number): boolean {
  return along(road, 12).some((p) => Math.hypot(p.x - x, p.y - y) < room);
}

function inGrove(groves: PlacedGrove[], x: number, y: number, pad: number): boolean {
  return groves.some((g) => {
    const dx = (x - g.cx) / (g.rx + pad);
    const dy = (y - g.cy) / (g.ry + pad);
    const card = Math.abs(x - g.cx) < Math.max(80, g.rx) + pad && y > g.labelY - pad && y < g.labelY + LABEL_H - 10;
    const crowns = Math.abs(x - g.cx) < g.rx && y < g.cy && y > g.cy - g.ry - 70;
    return dx * dx + dy * dy < 1 || card || crowns;
  });
}

function inCorner(c: OldCorner | null, x: number, y: number): boolean {
  return !!c && x > c.x - 10 && x < c.x + c.w + 10 && y > c.y - 10 && y < c.y + c.h + 10;
}

function placeLoose(loose: Grove | null, road: { x: number; y: number }[], groves: PlacedGrove[], corner: OldCorner | null, w: number) {
  if (!loose) return { loose: [] as PlacedTree[], looseHidden: 0, looseAt: null };
  const spots = along(road, 44).filter((p) => p.y > 20 && p.x > 16 && p.x < w - 16);
  const out: PlacedTree[] = [];
  let side = 1;
  for (const p of spots) {
    if (out.length >= loose.trees.length) break;
    // Beside the road, on either hand in turn
    const x = p.x - p.dy * (ROAD_HALF + 14) * side;
    const y = p.y + p.dx * (ROAD_HALF + 14) * side;
    side = -side;
    if (inGrove(groves, x, y, 12) || inCorner(corner, x, y) || x < 12 || x > w - 12) continue;
    out.push({ tree: loose.trees[out.length], x, y, scale: TREE_SCALE * 0.85 });
  }
  const first = spots[0];
  return {
    loose: out.sort((a, b) => a.y - b.y),
    looseHidden: loose.trees.length - out.length,
    looseAt: first ? { x: first.x, y: first.y - 40 } : null,
  };
}

/** Grass, stones and flowers over the open land, clear of everything else */
function scatterWild(w: number, h: number, groves: PlacedGrove[], corner: OldCorner | null, road: { x: number; y: number }[], loose: PlacedTree[]): Decor[] {
  const rnd = seeded(0x1b873593);
  const want = Math.min(WILD_MAX, Math.round((w * (h - TOP)) / 16000));
  const out: Decor[] = [];
  for (let tries = 0; out.length < want && tries < want * 6; tries++) {
    const x = 10 + rnd() * (w - 20);
    const y = TOP + rnd() * (h - TOP - 10);
    const size = 0.75 + rnd() * 0.5;
    const r = rnd();
    if (inGrove(groves, x, y, 18) || inCorner(corner, x, y) || nearRoad(road, x, y, ROAD_HALF + 10)) continue;
    if (loose.some((t) => Math.hypot(t.x - x, t.y - y) < 24)) continue;
    out.push({ x, y, size, kind: r < 0.6 ? "tuft" : r < 0.85 ? "flower" : "stone" });
  }
  return out.sort((a, b) => a.y - b.y);
}
