// ╔══════════════════════════════════════════════════════════════════════╗
// ║  ForestScene — draws a laid out forest as one SVG                     ║
// ║  Land, road, groves and trees are SVG; the cards under the groves    ║
// ║  and the other words are HTML on top, so they wrap and read either   ║
// ║  way. Zooming scales the whole stage.                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { setIcon } from "obsidian";
import {
  Decor, ForestLayout, Grove, OldCorner, PlacedGrove, PlacedTree, Season, Species, TreeKind, hashString, seeded,
} from "../utils/Forest";
import { projectColor } from "../utils/StatusColors";

export interface SceneOptions {
  season: Season;
  dark: boolean;
  zoom: number;
  /** Trees planted since the scene was last drawn, which grow in */
  fresh: Set<string>;
  /** The words at the top corner of the land */
  caption: { title: string; sub: string };
  /** The line under a grove's name */
  describeGrove: (grove: Grove, hidden: number) => string;
  /** The grove whose card is lit */
  selected: string | null;
  onTree: (p: PlacedTree, grove: Grove | null) => void;
  onGrove: (grove: Grove) => void;
  /** The corner with the old forest */
  corner: { title: string; sub: string; lines: string[]; onOpen: () => void } | null;
  /** Says what stands by the road; empty when nothing does */
  looseLabel: string;
  /** Shown over the land when nothing grew in the period */
  empty: string[] | null;
}

export interface SceneHandle {
  /** Where a point of the forest is on the scene, zoom and all */
  toScene: (x: number, y: number) => { x: number; y: number };
  /** Rings a tree as the one picked, or clears the ring */
  ring: (p: PlacedTree | null) => void;
}

type Pair = [string, string];

interface Palette {
  ground: Pair;
  patch: string;
  hill: string;
  road: [string, string, string];
  round: Pair[];
  pine: Pair[];
  blossom: Pair[];
  idle: Pair[];
  snow: boolean;
}

const LIGHT: Record<Season, Palette> = {
  spring: {
    ground: ["#EEF2E3", "#DCE7CC"], patch: "#E9EDD2", hill: "#D3E0BF", road: ["#E6E1CB", "#F3EFDF", "#FAF8EE"],
    round: [["#A2C392", "#527D5B"], ["#AEC985", "#6F9F65"], ["#ABC583", "#568653"], ["#86B18E", "#32674F"]],
    pine: [["#6F9F65", "#32674F"], ["#86B18E", "#32674F"]],
    blossom: [["#F0CCC3", "#CC9293"]],
    idle: [["#CDB67B", "#A99463"], ["#D6B887", "#AC9470"], ["#C9AE7C", "#8F7952"]], snow: false,
  },
  summer: {
    ground: ["#E8EFDC", "#CFE0BC"], patch: "#E2EACB", hill: "#C6D9AE", road: ["#E3DCC2", "#F1ECDA", "#F9F6EA"],
    round: [["#8DB878", "#3F6E46"], ["#9CC07F", "#4E7F4A"], ["#7FAF7F", "#2F5F45"], ["#A5C47E", "#5B8A4A"]],
    pine: [["#5E8F5A", "#28573F"], ["#6F9F65", "#2F5F45"]],
    blossom: [["#9CC07F", "#4E7F4A"]],
    idle: [["#CDB67B", "#A99463"], ["#D6B887", "#AC9470"], ["#C9AE7C", "#8F7952"]], snow: false,
  },
  autumn: {
    ground: ["#F1EFDF", "#E2DDBF"], patch: "#EEE7C9", hill: "#DCD5AE", road: ["#E5DCC2", "#F3EDDB", "#FAF7EC"],
    round: [["#E5BC74", "#B07A3A"], ["#DDA866", "#A2602F"], ["#CDBA70", "#8F7A3A"], ["#AEC985", "#6F9F65"], ["#E0A27E", "#AD5E3E"]],
    pine: [["#6F9F65", "#32674F"], ["#86B18E", "#32674F"]],
    blossom: [["#E5A88A", "#B86A50"]],
    idle: [["#C9A97A", "#8F7952"], ["#BFA27C", "#856B52"]], snow: false,
  },
  winter: {
    ground: ["#F3F5F4", "#DEE6E6"], patch: "#EEF2F0", hill: "#D7E0E0", road: ["#E2E5E0", "#F1F2EE", "#FAFAF7"],
    round: [["#DCE3DB", "#9FB1A3"], ["#CFD8CF", "#8EA396"]],
    pine: [["#7E9E86", "#3F6550"], ["#6F9078", "#355A47"]],
    blossom: [["#DCE3DB", "#9FB1A3"]],
    idle: [["#D3CBB8", "#A69C86"]], snow: true,
  },
};

const DARK_LAND: Record<Season, Pick<Palette, "ground" | "patch" | "hill" | "road">> = {
  spring: { ground: ["#26302A", "#1F2823"], patch: "#2D382F", hill: "#2A352C", road: ["#38392F", "#43433A", "#4C4C43"] },
  summer: { ground: ["#243028", "#1D2822"], patch: "#2B382D", hill: "#28352A", road: ["#37392F", "#424339", "#4B4C42"] },
  autumn: { ground: ["#2E2C25", "#26241F"], patch: "#36332A", hill: "#322F27", road: ["#3E3B31", "#48453B", "#514E44"] },
  winter: { ground: ["#2A2F30", "#232829"], patch: "#323839", hill: "#2E3435", road: ["#3B3E3D", "#454847", "#4F5251"] },
};

let sceneCount = 0;

export function renderForestScene(host: HTMLElement, layout: ForestLayout, o: SceneOptions): SceneHandle {
  host.empty();
  host.addClass("pm-forest-scene");
  const pal: Palette = o.dark ? { ...LIGHT[o.season], ...DARK_LAND[o.season] } : LIGHT[o.season];
  const tint = (c: string) => (o.dark ? shade(c, 0.82) : c);
  const id = `pmf${++sceneCount}`;
  const { width: w, height: h } = layout;

  // The stage is drawn at its own size and scaled for the zoom
  host.setCssStyles({ height: `${h * o.zoom}px`, width: "" });
  const stage = host.createDiv({ cls: "pm-forest-stage" });
  stage.setCssStyles({ width: `${w}px`, height: `${h}px` });
  const shift = Math.max(0, (host.clientWidth - w * o.zoom) / 2);
  stage.setCssStyles({ transform: `translateX(${shift}px) scale(${o.zoom})` });
  if (o.zoom > 1) host.setCssStyles({ width: `${w * o.zoom}px` });
  host.parentElement?.toggleClass("is-zoomed", o.zoom > 1);

  const svg = stage.createSvg("svg", { cls: "pm-forest-svg", attr: { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "group" } });
  const defs = svg.createSvg("defs");
  linear(defs, `${id}-ground`, pal.ground, true);
  radial(defs, `${id}-patch`, pal.patch);
  radial(defs, `${id}-hill`, pal.hill);
  const gradients = new Map<string, string>();
  const fillOf = (pair: Pair) => {
    const key = pair.join();
    let ref = gradients.get(key);
    if (!ref) {
      ref = `${id}-t${gradients.size}`;
      linear(defs, ref, [tint(pair[0]), tint(pair[1])], false);
      gradients.set(key, ref);
    }
    return `url(#${ref})`;
  };
  defineDecor(defs, id, o.dark);
  const placeDecor = (parent: SVGElement, d: Decor) =>
    parent.createSvg("use", { attr: { href: `#${id}-${d.kind}`, transform: `translate(${n(d.x)} ${n(d.y)}) scale(${n(d.size)})` } });

  // ── Land: soft rises, the road, a lighter patch under each grove ──
  svg.createSvg("rect", { attr: { width: w, height: h, fill: `url(#${id}-ground)` } });
  const hills = seeded(hashString(`hills${w}`));
  for (let y = 60; y < h; y += 170) {
    svg.createSvg("ellipse", {
      attr: { cx: n(hills() * w), cy: n(y + hills() * 80), rx: n(w * (0.35 + hills() * 0.3)), ry: n(60 + hills() * 50), fill: `url(#${id}-hill)` },
    });
  }
  for (const pg of layout.groves) {
    svg.createSvg("ellipse", { attr: { cx: n(pg.cx), cy: n(pg.cy + 2), rx: n(pg.rx * 1.25), ry: n(pg.ry * 1.45), fill: `url(#${id}-patch)` } });
  }
  if (layout.corner) {
    const c = layout.corner;
    svg.createSvg("ellipse", { attr: { cx: n(c.x + c.w / 2), cy: n(c.y + 110), rx: n(c.w * 0.6), ry: 70, fill: `url(#${id}-patch)` } });
  }
  const roadD = smoothPath(layout.road);
  const roadLine = (stroke: string, width: number, opacity: number) =>
    svg.createSvg("path", { attr: { d: roadD, stroke, "stroke-width": width, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", opacity } });
  roadLine(pal.road[0], 44, 0.7);
  roadLine(pal.road[1], 32, 1);
  roadLine(pal.road[2], 12, 0.8);

  const wild = svg.createSvg("g", { cls: "pm-forest-wild" });
  for (const d of layout.wild) placeDecor(wild, d);

  // ── Trees, one set of listeners for all of them ──
  const placed = new Map<Element, { p: PlacedTree; grove: Grove | null }>();
  const treeAt = (target: EventTarget | null) => {
    const g = target instanceof Element ? target.closest(".pm-forest-tree") : null;
    return g ? placed.get(g) ?? null : null;
  };
  svg.addEventListener("click", (e) => { const t = treeAt(e.target); if (t) o.onTree(t.p, t.grove); });
  svg.addEventListener("keydown", (e) => {
    const t = treeAt(e.target);
    if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); o.onTree(t.p, t.grove); }
  });
  const coloursFor = (species: Species, idle: boolean): Pair[] =>
    idle && species !== "pine" ? pal.idle : species === "pine" ? pal.pine : species === "blossom" ? pal.blossom : pal.round;
  const drawPlaced = (parent: SVGElement, p: PlacedTree, grove: Grove | null, idle: boolean) => {
    const g = parent.createSvg("g", {
      cls: o.fresh.has(p.tree.path) ? ["pm-forest-tree", "is-new"] : "pm-forest-tree",
      attr: { tabindex: 0, role: "button" },
    });
    const pair = pick(coloursFor(p.tree.species, idle), p.tree.slug);
    drawTree(g, p.x, p.y, p.scale, p.tree.kind, p.tree.species, fillOf(pair), p.tree.slug, o.dark, pal.snow);
    g.createSvg("desc").textContent = `${p.tree.title}${grove && grove.state !== "loose" ? `, ${grove.title}` : ""}`;
    placed.set(g, { p, grove });
  };

  // ── Tasks with no project, by the road ──
  if (layout.loose.length) {
    const g = svg.createSvg("g", { cls: "pm-forest-loose" });
    for (const p of layout.loose) drawPlaced(g, p, null, false);
  }

  // ── The old forest's corner ──
  if (layout.corner && o.corner) drawCorner(svg, stage, layout.corner, o.corner, (g, p) => drawPlaced(g, p, null, false), o.dark);

  // ── Groves ──
  for (const pg of layout.groves) {
    const idle = pg.grove.state === "idle";
    const g = svg.createSvg("g", { cls: ["pm-forest-grove", `is-${pg.grove.state}`], attr: { "data-key": pg.grove.key } });
    for (const d of pg.decor) placeDecor(g, d);
    const cabinY = pg.cabin?.y ?? Infinity;
    let cabinDrawn = false;
    for (const p of pg.trees) {
      if (!cabinDrawn && p.y > cabinY && pg.cabin) { drawCabin(g, pg.cabin.x, pg.cabin.y, pg.scale, o.dark); cabinDrawn = true; }
      drawPlaced(g, p, pg.grove, idle);
    }
    if (!cabinDrawn && pg.cabin) drawCabin(g, pg.cabin.x, pg.cabin.y, pg.scale, o.dark);
    groveCard(stage, pg, o, w);
  }

  // ── Words on the land ──
  const caption = stage.createDiv({ cls: "pm-forest-caption" });
  caption.createDiv({ cls: "pm-forest-caption-title", text: o.caption.title });
  caption.createDiv({ cls: "pm-forest-caption-sub", text: o.caption.sub });
  if (o.looseLabel && layout.looseAt) {
    const chip = stage.createDiv({ cls: "pm-forest-chip", text: o.looseLabel });
    chip.setCssStyles({ top: `${Math.min(Math.max(layout.looseAt.y, 70), h - 40)}px` });
    const half = chip.offsetWidth / 2;
    chip.setCssStyles({ left: `${half ? Math.min(Math.max(layout.looseAt.x, half + 8), w - half - 8) : layout.looseAt.x}px` });
  }
  if (o.empty) {
    const box = stage.createDiv({ cls: "pm-forest-empty" });
    o.empty.forEach((line, i) => box.createDiv({ cls: i ? "" : "pm-forest-empty-head", text: line }));
  }

  // The ring round a picked tree, under the tree itself
  let ring: SVGElement | null = null;
  return {
    toScene: (x, y) => ({ x: shift + x * o.zoom, y: y * o.zoom }),
    ring: (p) => {
      ring?.remove();
      ring = null;
      if (!p) return;
      const g = [...placed.entries()].find(([, v]) => v.p === p)?.[0];
      if (!g?.parentElement) return;
      const r = 11 * p.scale;
      ring = g.parentElement.createSvg("ellipse", { cls: "pm-forest-ring", attr: { cx: n(p.x), cy: n(p.y), rx: n(r * 1.9), ry: n(r * 0.62) } });
      g.parentElement.insertBefore(ring, g);
    },
  };
}

/** The white card under a grove: its name, a pin, what grew */
function groveCard(stage: HTMLElement, pg: PlacedGrove, o: SceneOptions, w: number): void {
  const { grove } = pg;
  const card = stage.createDiv({ cls: `pm-forest-card is-${grove.state}`, attr: { "data-key": grove.key } });
  if (o.selected === grove.key) card.addClass("is-selected");
  card.setCssProps({ "--pm-project-color": grove.state === "meadow" ? "#9aa0a6" : projectColor(grove.key) });
  card.setCssStyles({ top: `${pg.labelY}px`, maxWidth: `${pg.labelW}px` });
  const head = card.createDiv({ cls: "pm-forest-card-head" });
  head.createSpan({ cls: "pm-forest-card-name", text: grove.title });
  const tag = { idle: "Idle", finished: "Finished", stopped: "Stopped" }[grove.state as string];
  if (tag) head.createSpan({ cls: "pm-forest-card-tag", text: tag });
  if (grove.pinned) setIcon(head.createSpan({ cls: "pm-forest-card-pin" }), "pin");
  card.createDiv({ cls: "pm-forest-card-meta", text: o.describeGrove(grove, pg.hidden) });
  card.setAttrs({ role: "button", tabindex: "0", "aria-label": grove.state === "meadow" ? grove.members.join(", ") : grove.title });
  card.addEventListener("click", () => o.onGrove(grove));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onGrove(grove); } });
  // Centred under the grove, but kept inside the scene
  const half = card.offsetWidth / 2;
  card.setCssStyles({ left: `${half ? Math.min(Math.max(pg.cx, half + 8), w - half - 8) : pg.cx}px` });
}

function drawCorner(
  svg: SVGElement, stage: HTMLElement, c: OldCorner,
  words: { title: string; sub: string; lines: string[]; onOpen: () => void },
  drawPlaced: (g: SVGElement, p: PlacedTree) => void, dark: boolean
): void {
  const g = svg.createSvg("g", { cls: "pm-forest-corner" });
  const cabinY = c.cabin?.y ?? Infinity;
  let cabinDrawn = false;
  for (const p of c.trees) {
    if (!cabinDrawn && p.y > cabinY && c.cabin) { drawCabin(g, c.cabin.x, c.cabin.y, 0.7, dark); cabinDrawn = true; }
    drawPlaced(g, p);
  }
  if (!cabinDrawn && c.cabin) drawCabin(g, c.cabin.x, c.cabin.y, 0.7, dark);

  const box = stage.createDiv({ cls: "pm-forest-corner-box", attr: { role: "button", tabindex: "0", "aria-label": "Show the old forest" } });
  box.setCssStyles({ left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
  const head = box.createDiv({ cls: "pm-forest-corner-head" });
  setIcon(head.createSpan({ cls: "pm-forest-corner-icon" }), "archive");
  head.createSpan({ cls: "pm-forest-corner-title", text: words.title });
  head.createSpan({ cls: "pm-forest-corner-count", text: words.sub });
  box.createDiv({ cls: "pm-forest-corner-sub", text: "Finished & stopped · cabin = finished" });
  if (words.lines.length) {
    const list = box.createDiv({ cls: "pm-forest-corner-list" });
    for (const line of words.lines) list.createDiv({ text: line });
  }
  box.addEventListener("click", words.onOpen);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); words.onOpen(); } });
}

/** Scrolls a grove into view and makes its card blink */
export function flashGrove(host: HTMLElement, key: string): void {
  const card = host.querySelector<HTMLElement>(`.pm-forest-card[data-key="${CSS.escape(key)}"]`);
  if (!card) return;
  card.scrollIntoView({ block: "center", behavior: "smooth" });
  card.removeClass("is-flash");
  // Restarts the animation when the same grove is picked twice
  void card.getBoundingClientRect();
  card.addClass("is-flash");
  window.setTimeout(() => card.removeClass("is-flash"), 1700);
}

/** A single tree on its own, for the legend */
export function drawLegendTree(parent: HTMLElement, kind: TreeKind | "flower", season: Season, dark: boolean): void {
  const pal = LIGHT[season];
  const svg = parent.createSvg("svg", { cls: "pm-forest-legend-icon", attr: { viewBox: "-24 -58 48 62", width: 30, height: 30 } });
  const defs = svg.createSvg("defs");
  const ref = `pmfl${++sceneCount}`;
  if (kind === "flower") {
    defineDecor(defs, ref, dark);
    svg.createSvg("use", { attr: { href: `#${ref}-flower`, transform: "scale(3.6)" } });
    return;
  }
  const at = kind === "old" ? 3 : kind === "young" ? 1 : 2;
  const pair = pal.round[Math.min(at, pal.round.length - 1)];
  linear(defs, `${ref}-f`, dark ? [shade(pair[0], 0.82), shade(pair[1], 0.82)] : pair, false);
  const scale = kind === "old" ? 1 : kind === "young" ? 1.4 : kind === "sapling" ? 2.1 : 3.4;
  drawTree(svg, 0, 0, scale, kind, "round", `url(#${ref}-f)`, "legend", dark, false);
}

// ── Drawing ─────────────────────────────────────────────────────────────

function drawTree(
  g: SVGElement, x: number, y: number, s: number,
  kind: TreeKind, species: Species, fill: string, slug: string, dark: boolean, snow: boolean
): void {
  const P = (dx: number, dy: number) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  const shadow = (rx: number) =>
    g.createSvg("ellipse", { attr: { cx: n(x), cy: n(y), rx: n(rx * s), ry: n(rx * 0.3 * s), fill: dark ? "#000000" : "#7A8479", opacity: dark ? 0.3 : 0.2 } });
  const lobe = (dx: number, dy: number, r: number) =>
    g.createSvg("circle", { attr: { cx: n(x + dx * s), cy: n(y + dy * s), r: n(r * s), fill } });
  const wood = dark ? "#6E5A3E" : "#896E4A";
  const stroke = (d: string, width: number) =>
    g.createSvg("path", { attr: { d, stroke: wood, "stroke-width": n(width * s), "stroke-linecap": "round", fill: "none" } });

  if (kind === "sprout") {
    shadow(5);
    stroke(`M${P(0, 0)} L${P(0, -7)}`, 1.1);
    g.createSvg("path", { attr: { d: `M${P(0, -7)} C${P(-2, -11)} ${P(-7, -11)} ${P(-8, -8)} C${P(-6, -6)} ${P(-2, -6)} ${P(0, -7)} Z`, fill: dark ? "#6F8A55" : "#7A9659" } });
    g.createSvg("path", { attr: { d: `M${P(0, -7)} C${P(2, -11)} ${P(7, -11)} ${P(8, -8)} C${P(6, -6)} ${P(2, -6)} ${P(0, -7)} Z`, fill: dark ? "#879C6E" : "#94AA78" } });
    return;
  }

  if (species === "pine") {
    const tiers = kind === "old" ? 3 : 2;
    const k = kind === "old" ? 1 : kind === "young" ? 0.78 : 0.5;
    shadow(14 * k);
    g.createSvg("rect", { attr: { x: n(x - 1.6 * s * k), y: n(y - 8 * s * k), width: n(3.2 * s * k), height: n(8 * s * k), fill: wood } });
    for (let i = 0; i < tiers; i++) {
      const base = -(6 + i * 13) * k;
      const half = (17 - i * 4) * k;
      const top = base - (22 - i * 2) * k;
      g.createSvg("path", { attr: { d: `M${P(-half, base)} Q${P(0, base - 5 * k)} ${P(half, base)} L${P(0, top)} Z`, fill } });
      if (snow && i === tiers - 1) {
        g.createSvg("path", { attr: { d: `M${P(-half * 0.38, top + 8 * k)} L${P(0, top)} L${P(half * 0.38, top + 8 * k)} Z`, fill: "#F7FAFA" } });
      }
    }
    return;
  }

  if (kind === "sapling") {
    shadow(7);
    stroke(`M${P(0, 0)} L${P(0, -9)}`, 1.4);
    g.createSvg("path", { attr: { d: `M${P(0, -24)} C${P(7, -18)} ${P(8, -10)} ${P(0, -7)} C${P(-8, -10)} ${P(-7, -18)} ${P(0, -24)} Z`, fill } });
    stroke(`M${P(0, -9)} L${P(-3, -13)} M${P(0, -11)} L${P(3, -15)}`, 0.9);
    if (snow) g.createSvg("ellipse", { attr: { cx: n(x), cy: n(y - 21 * s), rx: n(3 * s), ry: n(1.4 * s), fill: "#F7FAFA" } });
    return;
  }

  // Round trees, and blossom: a cluster of lobes, each shaded on its own
  const lobes: [number, number, number][] = kind === "old"
    ? [[-11, -28, 12], [11, -29, 12], [-6, -40, 12], [7, -42, 12], [0, -24, 12]]
    : [[-7, -19, 8.5], [7, -20, 8.5], [0, -28, 9.5], [0, -16, 8]];
  shadow(kind === "old" ? 17 : 11);
  const trunk = kind === "old" ? 20 : 13;
  for (const [dx, dy, r] of lobes) lobe(dx, dy, r);
  // Trunk and branches over the lobes, as the design has them
  stroke(`M${P(0, 0)} L${P(0, -trunk)}`, kind === "old" ? 3 : 2.2);
  stroke(`M${P(0, -trunk * 0.55)} L${P(-trunk * 0.4, -trunk * 0.95)} M${P(0, -trunk * 0.7)} L${P(trunk * 0.38, -trunk * 1.1)}`, kind === "old" ? 1.6 : 1.2);
  if (species === "blossom") {
    const r = seeded(hashString(slug));
    for (let i = 0; i < (kind === "old" ? 6 : 4); i++) {
      const [dx, dy, lr] = lobes[i % lobes.length];
      g.createSvg("circle", { attr: { cx: n(x + (dx + (r() - 0.5) * lr) * s), cy: n(y + (dy + (r() - 0.5) * lr) * s), r: n(1.2 * s), fill: "#FFFDF8", opacity: 0.9 } });
    }
  }
  if (snow) {
    const [dx, dy, r] = lobes[kind === "old" ? 3 : 2];
    g.createSvg("ellipse", { attr: { cx: n(x + dx * s), cy: n(y + (dy - r * 0.7) * s), rx: n(r * 0.7 * s), ry: n(r * 0.28 * s), fill: "#F7FAFA" } });
  }
}

function drawCabin(g: SVGElement, x: number, y: number, s: number, dark: boolean): void {
  const P = (dx: number, dy: number) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  g.createSvg("ellipse", { attr: { cx: n(x), cy: n(y), rx: n(26 * s), ry: n(6 * s), fill: dark ? "#000000" : "#7A8479", opacity: 0.2 } });
  g.createSvg("rect", { attr: { x: n(x - 17 * s), y: n(y - 24 * s), width: n(34 * s), height: n(24 * s), fill: dark ? "#A88E66" : "#D9B989" } });
  g.createSvg("path", {
    attr: {
      d: `M${P(-23, -20)} L${P(0, -38)} L${P(23, -20)}`, stroke: dark ? "#6E5A3E" : "#856B52",
      "stroke-width": n(6 * s), "stroke-linejoin": "round", "stroke-linecap": "round", fill: "none",
    },
  });
}

/** The tuft, stone and flower the scenery is made of, placed by reference */
function defineDecor(defs: SVGElement, id: string, dark: boolean): void {
  const tuft = defs.createSvg("g", { attr: { id: `${id}-tuft` } });
  tuft.createSvg("path", {
    attr: {
      d: "M0 0 q-1 -5 -4 -8 M0 0 q0 -6 1 -10 M0 0 q1 -4 4 -7", stroke: dark ? "#6B7663" : "#A3B092",
      "stroke-width": 1.1, "stroke-linecap": "round", fill: "none", opacity: 0.75,
    },
  });
  const stone = defs.createSvg("g", { attr: { id: `${id}-stone` } });
  stone.createSvg("ellipse", { attr: { cy: -2, rx: 5.5, ry: 3, fill: dark ? "#4B5248" : "#C5CCB3" } });
  const flower = defs.createSvg("g", { attr: { id: `${id}-flower` } });
  flower.createSvg("path", { attr: { d: "M0 0 V-8", stroke: dark ? "#5F7550" : "#7A9659", "stroke-width": 1.2, "stroke-linecap": "round" } });
  flower.createSvg("circle", { attr: { cy: -9.5, r: 2.8, fill: dark ? "#C9AE85" : "#F6D6A3" } });
  flower.createSvg("circle", { attr: { cy: -9.5, r: 1.1, fill: "#C59958" } });
}

function linear(defs: SVGElement, id: string, [top, bottom]: Pair | string[], vertical: boolean): void {
  const lg = defs.createSvg("linearGradient", {
    attr: vertical ? { id, x1: 0, y1: 0, x2: 0, y2: 1 } : { id, x1: 0.2, y1: 0, x2: 0.75, y2: 1 },
  });
  lg.createSvg("stop", { attr: { offset: 0, "stop-color": top } });
  lg.createSvg("stop", { attr: { offset: 1, "stop-color": bottom } });
}

/** Solid in the middle, fading out to nothing at the rim */
function radial(defs: SVGElement, id: string, colour: string): void {
  const rg = defs.createSvg("radialGradient", { attr: { id } });
  rg.createSvg("stop", { attr: { offset: 0.55, "stop-color": colour, "stop-opacity": 1 } });
  rg.createSvg("stop", { attr: { offset: 1, "stop-color": colour, "stop-opacity": 0 } });
}

/** A smooth line through the points (Catmull-Rom as cubic Béziers) */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M${n(points[0].x)} ${n(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return d;
}

function pick<T>(list: T[], slug: string): T {
  return list[hashString(slug) % list.length];
}

function n(v: number): number {
  return Math.round(v * 10) / 10;
}

function shade(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `#${[v >> 16, (v >> 8) & 255, v & 255].map((c) => Math.max(0, Math.min(255, Math.round(c * f))).toString(16).padStart(2, "0")).join("")}`;
}
