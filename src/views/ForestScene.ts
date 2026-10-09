// ╔══════════════════════════════════════════════════════════════════════╗
// ║  ForestScene — draws a laid out forest as one SVG                     ║
// ║  Land, road, groves and trees are SVG; the names under the groves    ║
// ║  and the tooltip are HTML on top, so they wrap and read either way.  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { setIcon } from "obsidian";
import { ForestLayout, ForestTree, Grove, PlacedGrove, PlacedTree, Season, Species, TreeKind, hashString } from "../utils/Forest";
import { projectColor } from "../utils/StatusColors";

export interface SceneOptions {
  season: Season;
  dark: boolean;
  /** Trees planted since the scene was last drawn, which grow in */
  fresh: Set<string>;
  describeTree: (tree: ForestTree, grove: Grove) => string[];
  /** The line under a grove's name */
  describeGrove: (grove: Grove, hidden: number) => string;
  onTree: (tree: ForestTree) => void;
  onGrove: (grove: Grove) => void;
  /** Shown over the land when nothing grew in the period */
  empty: string[] | null;
  /** Says what is by the road; empty when nothing is */
  looseLabel: string;
}

interface Palette {
  sky: [string, string];
  hills: [string, string];
  ground: [string, string];
  grove: string;
  idleGrove: string;
  road: [string, string];
  round: string[];
  pine: string[];
  blossom: string[];
  idle: string[];
  snow: boolean;
}

const PALETTES: Record<Season, Palette> = {
  spring: {
    sky: ["#9fd3f2", "#e6f5fb"], hills: ["#bfe0a8", "#a9d68e"], ground: ["#a5d67f", "#78b85a"],
    grove: "#8cc96a", idleGrove: "#b3c06c", road: ["#d9c08a", "#e7d4a4"],
    round: ["#4f9a4a", "#5cab52", "#3f8a46", "#68b35a"], pine: ["#2f7a4a", "#3a8752"],
    blossom: ["#f2a7c3", "#f6bdd2", "#eb98b8"], idle: ["#d9862b", "#e0a53a", "#c4612a", "#d4742e"], snow: false,
  },
  summer: {
    sky: ["#7cc3f0", "#dff1fb"], hills: ["#a8d38a", "#8cc46f"], ground: ["#93c86b", "#5f9f45"],
    grove: "#7dba5a", idleGrove: "#aab865", road: ["#d6bb80", "#e6d09c"],
    round: ["#2f7d3b", "#3c8b45", "#2a6e35", "#47944c"], pine: ["#24683c", "#2f7646"],
    blossom: ["#3c8b45", "#47944c"], idle: ["#d9862b", "#e0a53a", "#c4612a", "#d4742e"], snow: false,
  },
  autumn: {
    sky: ["#a9cbe0", "#eef3f0"], hills: ["#d8cf8e", "#c7bf78"], ground: ["#c9c779", "#9aa552"],
    grove: "#b9bf66", idleGrove: "#c8b56a", road: ["#cfb27a", "#e0c995"],
    round: ["#d9862b", "#e0a53a", "#c4612a", "#b8892f", "#cf9b3a", "#7f9a3c", "#5f8f3e"], pine: ["#3b7a4e", "#46855a"],
    blossom: ["#c4612a", "#d4742e"], idle: ["#a8693a", "#b47c45", "#9a5a30"], snow: false,
  },
  winter: {
    sky: ["#c5d6e3", "#f2f6f9"], hills: ["#e8eef3", "#dbe5ec"], ground: ["#f1f5f8", "#d3dee5"],
    grove: "#e3ebef", idleGrove: "#dfe5e3", road: ["#cfd6dc", "#e1e6ea"],
    round: ["#8ea596", "#97ae9f", "#86a08f"], pine: ["#2f6b4a", "#3a7654"],
    blossom: ["#8ea596", "#97ae9f"], idle: ["#a39a8a", "#9a917f"], snow: true,
  },
};

const FLOWER_TINTS = ["#ffe066", "#ffffff", "#ffb3c7", "#c9b8ff"];
let sceneCount = 0;

export function renderForestScene(host: HTMLElement, layout: ForestLayout, o: SceneOptions): void {
  host.empty();
  host.addClass("pm-forest-scene");
  host.style.height = `${layout.height}px`;
  const pal = PALETTES[o.season];
  const tone = (c: string) => (o.dark ? shade(c, 0.74) : c);
  const id = `pmf${++sceneCount}`;
  const { width: w, height: h, horizon } = layout;

  const svg = host.createSvg("svg", {
    cls: "pm-forest-svg",
    attr: { width: w, height: h, viewBox: `0 0 ${w} ${h}`, "aria-hidden": "false", role: "group" },
  });
  const defs = svg.createSvg("defs");
  gradient(defs, `${id}-sky`, o.dark ? ["#121a31", "#3b3f66"] : pal.sky);
  gradient(defs, `${id}-ground`, [tone(pal.ground[0]), tone(pal.ground[1])]);

  // ── Sky ──
  svg.createSvg("rect", { attr: { width: w, height: horizon + 24, fill: `url(#${id}-sky)` } });
  const sky = seededPoints(hashString("sky"), 46);
  if (o.dark) {
    for (const [px, py, r] of sky) {
      svg.createSvg("circle", { attr: { cx: n(px * w), cy: n(py * (horizon - 20)), r: n(0.6 + r * 1.1), fill: "#ffffff", opacity: n(0.35 + r * 0.5) } });
    }
    svg.createSvg("circle", { attr: { cx: n(w * 0.86), cy: 44, r: 17, fill: "#f4f1d6" } });
    svg.createSvg("circle", { attr: { cx: n(w * 0.86 + 7), cy: 39, r: 15, fill: "#252c4d" } });
  } else {
    svg.createSvg("circle", { attr: { cx: n(w * 0.88), cy: 46, r: 38, fill: "#fff3b0", opacity: 0.3 } });
    svg.createSvg("circle", { attr: { cx: n(w * 0.88), cy: 46, r: 24, fill: "#fff3b0" } });
    for (const [cx, cy, s] of [[0.16, 44, 1], [0.52, 70, 0.8]]) {
      const g = svg.createSvg("g", { attr: { fill: "#ffffff", opacity: 0.9 } });
      g.createSvg("ellipse", { attr: { cx: n(w * cx), cy, rx: 40 * s, ry: 12 * s } });
      g.createSvg("ellipse", { attr: { cx: n(w * cx + 26 * s), cy: cy - 9 * s, rx: 26 * s, ry: 13 * s } });
    }
  }
  svg.createSvg("path", {
    attr: { d: `M0 ${horizon + 6} Q${n(w * 0.14)} ${horizon - 46} ${n(w * 0.3)} ${horizon - 4} T${n(w * 0.62)} ${horizon - 10} T${w} ${horizon - 6} V${horizon + 30} H0Z`, fill: tone(pal.hills[0]) },
  });
  svg.createSvg("path", {
    attr: { d: `M0 ${horizon + 14} Q${n(w * 0.22)} ${horizon - 24} ${n(w * 0.42)} ${horizon + 8} T${n(w * 0.82)} ${horizon} T${w} ${horizon + 8} V${horizon + 40} H0Z`, fill: tone(pal.hills[1]) },
  });

  // ── Land ──
  svg.createSvg("rect", { attr: { y: horizon + 8, width: w, height: h - horizon - 8, fill: `url(#${id}-ground)` } });
  if (layout.oldTop !== null) {
    svg.createSvg("rect", { cls: "pm-forest-oldland", attr: { y: n(layout.oldTop), width: w, height: n(h - layout.oldTop) } });
    svg.createSvg("path", { attr: { d: `M0 ${n(layout.oldTop)} H${w}`, stroke: o.dark ? "#ffffff" : "#000000", "stroke-opacity": 0.12, "stroke-dasharray": "2 6" } });
  }

  // ── Road, and a lane up to the hills ──
  const roadD = smoothPath(layout.road);
  const mid = layout.road[Math.round(layout.road.length * 0.55)];
  const lane = `M${n(mid.x - 13)} ${n(mid.y)} L${n(mid.x + 13)} ${n(mid.y)} L${n(mid.x + 34)} ${horizon + 6} L${n(mid.x + 28)} ${horizon + 6} Z`;
  svg.createSvg("path", { attr: { d: lane, fill: tone(pal.road[0]) } });
  svg.createSvg("path", { attr: { d: roadD, stroke: tone(pal.road[0]), "stroke-width": 26, fill: "none", "stroke-linecap": "round" } });
  svg.createSvg("path", { attr: { d: roadD, stroke: tone(pal.road[1]), "stroke-width": 12, fill: "none", "stroke-linecap": "round" } });

  // ── Tooltip, shared by every tree ──
  const tip = host.createDiv({ cls: "pm-forest-tip pm-hidden" });
  const showTip = (p: PlacedTree, grove: Grove) => {
    tip.empty();
    o.describeTree(p.tree, grove).forEach((line, i) => tip.createDiv({ cls: i ? "pm-forest-tip-row" : "pm-forest-tip-head", text: line }));
    tip.removeClass("pm-hidden");
    const left = Math.min(Math.max(8, p.x + 16), Math.max(8, w - tip.offsetWidth - 8));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(4, p.y - 46 * p.scale - tip.offsetHeight)}px`;
  };
  const hideTip = () => tip.addClass("pm-hidden");

  // One set of listeners for every tree rather than six on each
  const placed = new Map<Element, { p: PlacedTree; grove: Grove }>();
  const treeAt = (target: EventTarget | null) => {
    const g = target instanceof Element ? target.closest(".pm-forest-tree") : null;
    return g ? placed.get(g) ?? null : null;
  };
  const enter = (e: Event) => { const t = treeAt(e.target); if (t) showTip(t.p, t.grove); };
  const leave = (e: MouseEvent | FocusEvent) => { if (treeAt(e.target) !== treeAt(e.relatedTarget)) hideTip(); };
  svg.addEventListener("mouseover", enter);
  svg.addEventListener("focusin", enter);
  svg.addEventListener("mouseout", leave);
  svg.addEventListener("focusout", leave);
  svg.addEventListener("click", (e) => { const t = treeAt(e.target); if (t) o.onTree(t.p.tree); });
  svg.addEventListener("keydown", (e) => {
    const t = treeAt(e.target);
    if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); o.onTree(t.p.tree); }
  });

  const drawPlaced = (parent: SVGElement, p: PlacedTree, grove: Grove, colours: string[]) => {
    const g = parent.createSvg("g", {
      cls: o.fresh.has(p.tree.path) ? ["pm-forest-tree", "is-new"] : "pm-forest-tree",
      attr: { tabindex: 0, role: "button" },
    });
    drawTree(g, p.x, p.y, p.scale, p.tree.kind, p.tree.species, pick(colours, p.tree.slug), tone, pal.snow);
    // Read out by screen readers; a <title> would also pop the browser's own tooltip
    g.createSvg("desc").textContent = o.describeTree(p.tree, grove).join(" · ");
    placed.set(g, { p, grove });
  };
  const coloursFor = (species: Species, idle: boolean) =>
    idle && species !== "pine" ? pal.idle : species === "pine" ? pal.pine : species === "blossom" ? pal.blossom : pal.round;

  // ── Tasks with no project, along the road ──
  if (layout.loose.length) {
    const g = svg.createSvg("g", { cls: "pm-forest-loose" });
    const grove = { key: "~loose" } as Grove;
    for (const p of layout.loose) drawPlaced(g, p, grove, coloursFor(p.tree.species, false));
  }
  if (o.looseLabel) {
    host.createDiv({ cls: "pm-forest-loose-label", text: o.looseLabel }).style.top = `${horizon + 4}px`;
  }

  // ── Groves ──
  for (const pg of layout.groves) drawGrove(svg, host, pg, o, pal, tone, coloursFor, drawPlaced);

  if (layout.oldTop !== null) {
    const head = host.createDiv({ cls: "pm-forest-oldhead" });
    head.style.top = `${layout.oldTop + 10}px`;
    head.createSpan({ cls: "pm-forest-oldhead-title", text: "Old forest" });
    head.appendText(" · finished and stopped projects");
  }

  if (o.empty) {
    const box = host.createDiv({ cls: "pm-forest-empty" });
    box.style.top = `${horizon + 96}px`;
    o.empty.forEach((line, i) => box.createDiv({ cls: i ? "" : "pm-forest-empty-head", text: line }));
  }
}

function drawGrove(
  svg: SVGElement,
  host: HTMLElement,
  pg: PlacedGrove,
  o: SceneOptions,
  pal: Palette,
  tone: (c: string) => string,
  coloursFor: (species: Species, idle: boolean) => string[],
  drawPlaced: (parent: SVGElement, p: PlacedTree, grove: Grove, colours: string[]) => void
): void {
  const { grove, cx, cy, rx, ry } = pg;
  const idle = grove.state === "idle";
  const key = grove.key;
  const g = svg.createSvg("g", { cls: ["pm-forest-grove", `is-${grove.state}`], attr: { "data-key": key } });
  const colour = grove.state === "meadow" ? "#9aa0a6" : projectColor(key);
  g.createSvg("ellipse", {
    cls: "pm-forest-plot",
    attr: {
      cx: n(cx), cy: n(cy), rx: n(rx), ry: n(ry),
      fill: tone(idle && !pal.snow ? pal.idleGrove : pal.grove),
      stroke: colour, "stroke-opacity": 0.6, "stroke-width": 2, "stroke-dasharray": "6 5",
    },
  });

  for (const f of pg.flowers) {
    g.createSvg("circle", { attr: { cx: n(f.x), cy: n(f.y), r: n(2.2 * pg.scale), fill: tone(FLOWER_TINTS[f.tint]) } });
  }
  if (idle) {
    const tufts = seededPoints(hashString(key) ^ 77, 26);
    for (const [a, d] of tufts) {
      const x = cx + Math.cos(a * Math.PI * 2) * Math.sqrt(d) * 0.9 * rx;
      const y = cy + Math.sin(a * Math.PI * 2) * Math.sqrt(d) * 0.9 * ry;
      g.createSvg("path", { attr: { d: `M${n(x)} ${n(y)} l-2 -7 M${n(x)} ${n(y)} l1 -9 M${n(x)} ${n(y)} l3 -6`, stroke: tone("#8a9a3c"), "stroke-width": 1.2 } });
      g.createSvg("circle", { attr: { cx: n(x + 6), cy: n(y + 2), r: 1.8, fill: tone("#d9862b") } });
    }
  }

  // Trees and the cabin, back to front
  const cabinY = pg.cabin?.y ?? Infinity;
  let cabinDrawn = false;
  for (const p of pg.trees) {
    if (!cabinDrawn && p.y > cabinY && pg.cabin) { drawCabin(g, pg.cabin.x, pg.cabin.y, pg.scale, tone); cabinDrawn = true; }
    drawPlaced(g, p, grove, coloursFor(p.tree.species, idle));
  }
  if (!cabinDrawn && pg.cabin) drawCabin(g, pg.cabin.x, pg.cabin.y, pg.scale, tone);

  // The name under the grove
  const label = host.createDiv({ cls: `pm-forest-label is-${grove.state}`, attr: { "data-key": key } });
  label.style.left = `${cx}px`;
  label.style.top = `${pg.labelY}px`;
  label.style.maxWidth = `${Math.max(140, rx * 2 + 20)}px`;
  label.setCssProps({ "--pm-project-color": colour });
  const head = label.createDiv({ cls: "pm-forest-label-head" });
  head.createSpan({ cls: "pm-forest-label-dot" });
  if (grove.pinned) setIcon(head.createSpan({ cls: "pm-forest-label-pin" }), "pin");
  const name = head.createSpan({ cls: "pm-forest-label-name", text: grove.title });
  label.createDiv({ cls: "pm-forest-label-meta", text: o.describeGrove(grove, pg.hidden) });
  if (grove.state === "meadow") {
    label.setAttr("aria-label", grove.members.join(", "));
  } else {
    name.addClass("is-link");
    name.setAttrs({ role: "link", tabindex: "0" });
    name.addEventListener("click", () => o.onGrove(grove));
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") o.onGrove(grove); });
  }
}

/** Scrolls a grove into view and makes it blink */
export function flashGrove(host: HTMLElement, key: string): void {
  const label = host.querySelector<HTMLElement>(`.pm-forest-label[data-key="${CSS.escape(key)}"]`);
  const grove = host.querySelector<SVGElement>(`.pm-forest-grove[data-key="${CSS.escape(key)}"]`);
  if (!label || !grove) return;
  label.scrollIntoView({ block: "center", behavior: "smooth" });
  for (const el of [label, grove]) {
    el.removeClass("is-flash");
    // Restarts the animation when the same grove is picked twice
    void el.getBoundingClientRect();
    el.addClass("is-flash");
    window.setTimeout(() => el.removeClass("is-flash"), 1700);
  }
}

/** A single tree on its own, for the legend */
export function drawLegendTree(parent: HTMLElement, kind: TreeKind | "cabin" | "idle", season: Season, dark: boolean): void {
  const pal = PALETTES[season];
  const tone = (c: string) => (dark ? shade(c, 0.74) : c);
  const svg = parent.createSvg("svg", { cls: "pm-forest-legend-icon", attr: { viewBox: "-22 -50 44 54", width: 26, height: 26 } });
  if (kind === "cabin") drawCabin(svg, 0, 0, 0.9, tone);
  else if (kind === "idle") {
    for (const x of [-12, -2, 9]) {
      svg.createSvg("path", { attr: { d: `M${x} 0 l-4 -16 M${x} 0 l2 -22 M${x} 0 l6 -14`, stroke: tone("#8a9a3c"), "stroke-width": 2.4, fill: "none" } });
    }
    svg.createSvg("circle", { attr: { cx: 15, cy: -2, r: 3.2, fill: tone("#d9862b") } });
  }
  else drawTree(svg, 0, 0, kind === "old" ? 1 : kind === "young" ? 1.5 : 2.2, kind, "round", pal.round[1], tone, pal.snow);
}

export function drawLegendFlower(parent: HTMLElement): void {
  const svg = parent.createSvg("svg", { cls: "pm-forest-legend-icon", attr: { viewBox: "-6 -6 12 12", width: 26, height: 26 } });
  svg.createSvg("circle", { attr: { r: 3, fill: FLOWER_TINTS[0] } });
  svg.createSvg("circle", { attr: { r: 1.3, fill: "#e0a800" } });
}

// ── Drawing ─────────────────────────────────────────────────────────────

function drawTree(
  g: SVGElement, x: number, y: number, s: number,
  kind: TreeKind, species: Species, colour: string,
  tone: (c: string) => string, snow: boolean
): void {
  const c = tone(colour);
  const lit = tone(lighten(colour, 0.28));
  const trunk = tone("#7a5233");
  const shadow = (rx: number, ry: number) => g.createSvg("ellipse", { attr: { cx: n(x), cy: n(y), rx: n(rx * s), ry: n(ry * s), fill: "#000000", opacity: 0.16 } });
  const circle = (cx: number, cy: number, r: number, fill: string) => g.createSvg("circle", { attr: { cx: n(x + cx * s), cy: n(y + cy * s), r: n(r * s), fill } });

  if (kind === "sprout" || kind === "sapling") {
    const leaf = kind === "sprout" ? tone("#7bd389") : c;
    const size = kind === "sprout" ? 0.8 : 1;
    shadow(6 * size, 2.5 * size);
    g.createSvg("path", { attr: { d: `M${n(x)} ${n(y)} V${n(y - 9 * s * size)}`, stroke: tone("#6b4a2b"), "stroke-width": n(1.6 * s) } });
    g.createSvg("ellipse", { attr: { cx: n(x - 3.5 * s * size), cy: n(y - 8 * s * size), rx: n(4 * s * size), ry: n(2.2 * s * size), fill: leaf, transform: `rotate(-25 ${n(x - 3.5 * s * size)} ${n(y - 8 * s * size)})` } });
    g.createSvg("ellipse", { attr: { cx: n(x + 3.5 * s * size), cy: n(y - 10 * s * size), rx: n(4 * s * size), ry: n(2.2 * s * size), fill: kind === "sprout" ? leaf : lit, transform: `rotate(25 ${n(x + 3.5 * s * size)} ${n(y - 10 * s * size)})` } });
    return;
  }

  if (species === "pine") {
    const tiers = kind === "old" ? 3 : 2;
    const size = kind === "old" ? 1 : 0.75;
    shadow(14 * size, 4 * size);
    g.createSvg("rect", { attr: { x: n(x - 2.5 * s * size), y: n(y - 9 * s * size), width: n(5 * s * size), height: n(9 * s * size), fill: tone("#6b4a2b") } });
    for (let i = 0; i < tiers; i++) {
      const base = y - (8 + i * 11) * s * size;
      const half = (16 - i * 4) * s * size;
      const top = base - 18 * s * size;
      g.createSvg("path", { attr: { d: `M${n(x - half)} ${n(base)} L${n(x)} ${n(top)} L${n(x + half)} ${n(base)} Z`, fill: i === tiers - 1 ? lit : c } });
      if (snow && i === tiers - 1) {
        g.createSvg("path", { attr: { d: `M${n(x - half * 0.4)} ${n(top + 7 * s * size)} L${n(x)} ${n(top)} L${n(x + half * 0.4)} ${n(top + 7 * s * size)} Z`, fill: "#f4f8fb" } });
      }
    }
    return;
  }

  if (kind === "young") {
    shadow(11, 3.5);
    g.createSvg("rect", { attr: { x: n(x - 2 * s), y: n(y - 14 * s), width: n(4 * s), height: n(14 * s), fill: trunk } });
    circle(0, -21, 10, c);
    circle(-3.5, -24, 4.5, lit);
    if (snow) g.createSvg("ellipse", { attr: { cx: n(x), cy: n(y - 29 * s), rx: n(7 * s), ry: n(2.6 * s), fill: "#f4f8fb" } });
    return;
  }

  shadow(17, 5);
  g.createSvg("rect", { attr: { x: n(x - 3 * s), y: n(y - 22 * s), width: n(6 * s), height: n(22 * s), fill: trunk } });
  circle(-11, -27, 12, c);
  circle(11, -27, 12, c);
  circle(0, -36, 17, c);
  circle(-6, -42, 7.5, lit);
  if (snow) g.createSvg("ellipse", { attr: { cx: n(x), cy: n(y - 51 * s), rx: n(11 * s), ry: n(3.4 * s), fill: "#f4f8fb" } });
}

function drawCabin(g: SVGElement, x: number, y: number, s: number, tone: (c: string) => string): void {
  const p = (dx: number, dy: number) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  g.createSvg("ellipse", { attr: { cx: n(x), cy: n(y), rx: n(24 * s), ry: n(6 * s), fill: "#000000", opacity: 0.18 } });
  g.createSvg("rect", { attr: { x: n(x - 18 * s), y: n(y - 20 * s), width: n(36 * s), height: n(20 * s), fill: tone("#c9a27a") } });
  g.createSvg("path", { attr: { d: `M${p(-22, -19)} L${p(0, -36)} L${p(22, -19)} Z`, fill: tone("#9c4a3a") } });
  g.createSvg("rect", { attr: { x: n(x - 4 * s), y: n(y - 12 * s), width: n(8 * s), height: n(12 * s), fill: tone("#6b3f26") } });
  g.createSvg("rect", { attr: { x: n(x + 8 * s), y: n(y - 15 * s), width: n(6 * s), height: n(6 * s), fill: "#ffe9a8" } });
  g.createSvg("path", { attr: { d: `M${p(14, -30)} V${n(y - 46 * s)}`, stroke: tone("#555555"), "stroke-width": n(1.4 * s) } });
  g.createSvg("path", { attr: { d: `M${p(14, -46)} L${p(26, -42)} L${p(14, -38)} Z`, fill: "#7bd389" } });
}

function gradient(defs: SVGElement, id: string, [top, bottom]: [string, string] | string[]): void {
  const lg = defs.createSvg("linearGradient", { attr: { id, x1: 0, y1: 0, x2: 0, y2: 1 } });
  lg.createSvg("stop", { attr: { offset: 0, "stop-color": top } });
  lg.createSvg("stop", { attr: { offset: 1, "stop-color": bottom } });
}

function smoothPath(points: { x: number; y: number }[]): string {
  let d = `M${n(points[0].x)} ${n(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const p = points[i];
    d += ` Q${n(prev.x)} ${n(prev.y)} ${n((prev.x + p.x) / 2)} ${n((prev.y + p.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${n(last.x)} ${n(last.y)}`;
}

/** [x, y, size] triples in [0, 1), the same every time */
function seededPoints(seed: number, count: number): number[][] {
  let a = seed | 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => [next(), next(), next()]);
}

function pick(list: string[], slug: string): string {
  return list[hashString(slug) % list.length];
}

function n(v: number): number {
  return Math.round(v * 10) / 10;
}

function channels(hex: string): number[] {
  const v = parseInt(hex.slice(1), 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
}

function toHex(c: number[]): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function shade(hex: string, f: number): string {
  return toHex(channels(hex).map((v) => v * f));
}

function lighten(hex: string, f: number): string {
  return toHex(channels(hex).map((v) => v + (255 - v) * f));
}
