// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Forest                                                              ║
// ║  A dashboard tab where finished tasks grow as trees, each project    ║
// ║  a grove, for the period picked at its top. Drawn from the same      ║
// ║  data as the Overview; nothing is written to the vault.              ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Menu, Setting, TFile, setIcon } from "obsidian";
import type ProjectManagerPlugin from "../main";
import type { DashboardContext, DashboardTab, PeriodRange } from "../core/Extensions";
import {
  Forest, ForestTree, ForestView, Grove, IDLE_DAYS, PlacedTree, Season, buildForest, layoutForest, seasonOf,
} from "../utils/Forest";
import { SceneHandle, drawLegendTree, flashGrove, renderForestScene } from "../views/ForestScene";
import { formatHours } from "../views/DashboardCharts";
import { addDays, daysBetween, todayISO } from "../utils/Jalali";
import { projectColor } from "../utils/StatusColors";

type GroveOrder = "forest" | "hours" | "name";

/** What the tab remembers while Obsidian is open */
interface ForestState {
  /** The trees each period last showed, so the ones planted since grow in */
  seen: Map<string, Set<string>>;
  view: ForestView;
  /** A season picked by hand; null follows the period */
  season: Season | null;
  zoom: number;
  /** The grove picked, per workspace */
  selected: Map<string, string>;
  order: GroveOrder;
}

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5];
const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

export function setupForest(plugin: ProjectManagerPlugin): void {
  const state: ForestState = { seen: new Map(), view: "active", season: null, zoom: 1, selected: new Map(), order: "forest" };
  const tab: DashboardTab = {
    id: "forest",
    label: () => "Forest",
    ownsPeriod: true,
    render: (root, ctx) => renderForestTab(plugin, root, ctx, state),
  };
  const sync = () => {
    const at = plugin.ext.dashboardTabs.indexOf(tab);
    if (plugin.settings.showForest && at < 0) plugin.ext.dashboardTabs.push(tab);
    if (!plugin.settings.showForest && at >= 0) plugin.ext.dashboardTabs.splice(at, 1);
  };
  sync();

  plugin.ext.settingsSections.push((el) => {
    new Setting(el).setName("Forest").setHeading();
    new Setting(el)
      .setName("Show the forest tab")
      .setDesc("A tab on the project dashboard where every finished task grows a tree in its project's grove.")
      .addToggle((t) => t.setValue(plugin.settings.showForest).onChange(async (v) => {
        plugin.settings.showForest = v;
        await plugin.saveSettings();
        sync();
        plugin.refreshProjectDashboard();
      }));
  });
}

function renderForestTab(plugin: ProjectManagerPlugin, root: HTMLElement, ctx: DashboardContext, state: ForestState): void {
  const cal = plugin.calendar;
  const today = todayISO();
  const { data } = ctx;
  const frontmatter = (file: TFile) => plugin.app.metadataCache.getFileCache(file)?.frontmatter;

  const forest = buildForest({
    tasks: data.tasks.map((t) => ({
      slug: t.slug,
      title: t.title,
      path: t.file.path,
      status: t.status,
      projectSlug: t.projectSlug,
      totalHours: t.totalHours,
      completed: t.completed,
      pomodoros: Number(frontmatter(t.file)?.pomodoros ?? 0) || 0,
    })),
    projects: data.projects,
    records: data.records,
    from: ctx.from,
    to: ctx.effTo,
    today,
    pinned: (slug) => plugin.isProjectPinned(ctx.ws, slug),
  });
  if (state.view === "old" && !forest.old.length) state.view = "active";

  // A short period shows its own season; a year or more shows today's
  const span = daysBetween(ctx.from, ctx.to);
  const seasonDay = span > 100 ? today : addDays(ctx.from, Math.floor(span / 2));
  const autoSeason = seasonOf(cal.fromISO(seasonDay).m, cal.kind);
  const dark = document.body.hasClass("theme-dark");
  const rtl = plugin.settings.boardDirection === "rtl";
  const range = ctx.period.range;
  // "this month", or "in May 2026" for a month gone by
  const during = range === "all" ? "in all" : ctx.period.atToday ? `this ${range}` : `in ${ctx.periodLabel}`;

  const planted = new Set(allTrees(forest).filter((t) => t.kind !== "sprout").map((t) => t.path));
  const seenKey = `${ctx.ws.id}|${ctx.from}|${ctx.to}`;
  const before = state.seen.get(seenKey);
  let fresh = before ? new Set([...planted].filter((p) => !before.has(p))) : new Set<string>();
  state.seen.set(seenKey, planted);

  const page = root.createDiv({ cls: "pm-forest", attr: { dir: rtl ? "rtl" : "ltr" } });

  // ── Heading and period ──
  const top = page.createDiv({ cls: "pm-forest-top" });
  const heading = top.createDiv({ cls: "pm-forest-heading" });
  heading.createDiv({ cls: "pm-forest-title", text: "Your work, taking root." });
  heading.createDiv({ cls: "pm-forest-subtitle", text: "A living forest of completed tasks and the projects you nurture." });
  const period = top.createDiv({ cls: "pm-forest-period" });
  const seg = period.createDiv({ cls: "pm-forest-seg" });
  const RANGES: [PeriodRange, string][] = [["week", "Week"], ["month", "Month"], ["season", "Season"], ["year", "Year"], ["all", "All time"]];
  for (const [id, label] of RANGES) {
    const b = seg.createEl("button", { text: label, cls: id === range ? "is-active" : "" });
    b.setAttr("aria-pressed", String(id === range));
    b.addEventListener("click", () => ctx.period.setRange(id));
  }
  const nav = period.createDiv({ cls: "pm-forest-nav" });
  const prev = nav.createEl("button", { attr: { "aria-label": "Previous period" } });
  setIcon(prev, rtl ? "chevron-right" : "chevron-left");
  prev.disabled = range === "all";
  prev.addEventListener("click", () => ctx.period.step(-1));
  nav.createSpan({ cls: "pm-forest-nav-label", text: ctx.periodLabel });
  const next = nav.createEl("button", { attr: { "aria-label": "Next period" } });
  setIcon(next, rtl ? "chevron-left" : "chevron-right");
  next.disabled = range === "all";
  next.addEventListener("click", () => ctx.period.step(1));
  const todayBtn = period.createEl("button", { cls: "pm-forest-today", text: "Today" });
  todayBtn.disabled = ctx.period.atToday;
  todayBtn.addEventListener("click", () => ctx.period.today());

  // ── What grew ──
  const stats = page.createDiv({ cls: "pm-forest-stats" });
  const stat = (icon: string, value: string, label: string) => {
    const s = stats.createDiv({ cls: "pm-forest-stat" });
    setIcon(s.createSpan({ cls: "pm-forest-stat-icon" }), icon);
    s.createSpan({ cls: "pm-forest-stat-value", text: value });
    s.createSpan({ cls: "pm-forest-stat-label", text: label });
  };
  stat("clock", formatHours(forest.hours), `tracked ${during}`);
  stat("trees", String(forest.planted), forest.planted === 1 ? "completed task" : "completed tasks");
  stat("sprout", String(forest.sprouts), forest.sprouts === 1 ? "open task sprout" : "open task sprouts");
  stat("flower-2", String(forest.flowers), forest.flowers === 1 ? "pomodoro flower" : "pomodoro flowers");
  const note = stats.createDiv({ cls: "pm-forest-stat-note" });
  setIcon(note.createSpan(), "check");
  note.createSpan({ text: "Grown from your notes" });

  const body = page.createDiv({ cls: "pm-forest-body" });
  const main = body.createDiv({ cls: "pm-forest-main" });
  const side = body.createDiv({ cls: "pm-forest-side" });

  const projectFile = (key: string) => data.projectsBySlug.get(key)?.file ?? null;
  const groves = () => (state.view === "active" ? forest.groves : forest.old);
  const everyGrove = () => [...groves(), ...(state.view === "active" && forest.loose ? [forest.loose] : [])];
  const selectedGrove = () => {
    const key = state.selected.get(ctx.ws.id);
    const list = everyGrove();
    return list.find((g) => g.key === key) ?? list[0] ?? null;
  };
  const select = (grove: Grove, flash: boolean) => {
    state.selected.set(ctx.ws.id, grove.key);
    drawSide();
    for (const card of Array.from(main.querySelectorAll<HTMLElement>(".pm-forest-card"))) {
      card.toggleClass("is-selected", card.dataset.key === grove.key);
    }
    if (flash) flashGrove(main, grove.key);
  };

  // ── The card with the forest ──
  const head = main.createDiv({ cls: "pm-forest-main-head" });
  const views = head.createDiv({ cls: "pm-forest-views" });
  const viewBtn = (view: ForestView, icon: string, label: string, count: number) => {
    const b = views.createEl("button", { cls: state.view === view ? "is-active" : "" });
    setIcon(b.createSpan({ cls: "pm-forest-view-icon" }), icon);
    b.createSpan({ text: label });
    b.createSpan({ cls: "pm-forest-view-count", text: String(count) });
    b.setAttr("aria-pressed", String(state.view === view));
    b.disabled = view === "old" && !forest.old.length;
    b.addEventListener("click", () => {
      if (state.view === view) return;
      state.view = view;
      ctx.refresh();
    });
  };
  viewBtn("active", "trees", "Active forest", forest.groves.length);
  viewBtn("old", "archive", "Old forest", forest.old.length);
  const seasons = head.createDiv({ cls: "pm-forest-seasons" });
  seasons.createSpan({ cls: "pm-forest-seasons-label", text: "Season" });
  const seasonBtns = SEASONS.map((s) => {
    const b = seasons.createEl("button", { text: s[0].toUpperCase() + s.slice(1) });
    b.addEventListener("click", () => {
      state.season = s === autoSeason ? null : s;
      drawScene();
    });
    return b;
  });

  const sceneBox = main.createDiv({ cls: "pm-forest-scenebox" });
  const sceneHost = sceneBox.createDiv();
  const zoomBox = sceneBox.createDiv({ cls: "pm-forest-zoom" });
  const zoomBtn = (icon: string, label: string, dir: 1 | -1) => {
    const b = zoomBox.createEl("button", { attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", () => {
      const at = ZOOMS.indexOf(state.zoom);
      state.zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? 2 : at) + dir))];
      drawScene();
    });
  };
  zoomBtn("plus", "Zoom in", 1);
  zoomBtn("minus", "Zoom out", -1);

  const legend = main.createDiv({ cls: "pm-forest-legend" });

  let popover: HTMLElement | null = null;
  let handle: SceneHandle | null = null;
  const closePopover = () => {
    popover?.remove();
    popover = null;
    handle?.ring(null);
  };
  sceneBox.addEventListener("keydown", (e) => { if (e.key === "Escape" && popover) { e.stopPropagation(); closePopover(); } });

  const openTree = (p: PlacedTree, grove: Grove | null) => {
    closePopover();
    handle?.ring(p);
    const tree = p.tree;
    const box = sceneBox.createDiv({ cls: "pm-forest-pop", attr: { role: "dialog", "aria-label": tree.title } });
    popover = box;
    const top = box.createDiv({ cls: "pm-forest-pop-head" });
    setIcon(top.createSpan({ cls: "pm-forest-pop-icon" }), tree.kind === "sprout" ? "sprout" : tree.species === "pine" ? "tree-pine" : "tree-deciduous");
    top.createSpan({ cls: "pm-forest-pop-kind", text: KIND_NAME[tree.kind] });
    const close = top.createEl("button", { cls: "pm-forest-pop-close", attr: { "aria-label": "Close" } });
    setIcon(close, "x");
    close.addEventListener("click", closePopover);
    const title = box.createDiv({ cls: "pm-forest-pop-title", text: tree.title, attr: { role: "link", tabindex: "0" } });
    const open = () => {
      const file = plugin.app.vault.getAbstractFileByPath(tree.path);
      if (file instanceof TFile) plugin.openTaskModal(file, ctx.ws);
    };
    title.addEventListener("click", open);
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    box.createDiv({ cls: "pm-forest-pop-project", text: tree.projectSlug ? data.projectsBySlug.get(tree.projectSlug)?.title ?? tree.projectSlug : "No project" });
    const facts = box.createDiv({ cls: "pm-forest-pop-facts" });
    const fact = (label: string, value: string) => {
      const f = facts.createDiv();
      f.createDiv({ cls: "pm-forest-pop-label", text: label });
      f.createDiv({ cls: "pm-forest-pop-value", text: value });
    };
    fact("Tracked time", formatHours(tree.hours));
    if (tree.completed) fact("Completed", cal.label(tree.completed));
    else fact("Status", "Still growing");
    const foot = box.createDiv({ cls: "pm-forest-pop-foot" });
    setIcon(foot.createSpan(), tree.kind === "sprout" ? "circle-dashed" : "circle-check");
    foot.createSpan({ text: KIND_NOTE[tree.kind] });
    if (grove && grove.state !== "loose") select(grove, false);

    // Under the tree when there is room, above it when not
    const at = handle?.toScene(p.x, p.y) ?? { x: p.x, y: p.y };
    const boxW = box.offsetWidth;
    const boxH = box.offsetHeight;
    const roomW = sceneBox.clientWidth;
    const left = Math.min(Math.max(8, at.x - boxW / 2), Math.max(8, roomW - boxW - 8));
    const below = at.y + 14;
    const above = at.y - 60 * p.scale * state.zoom - boxH - 8;
    box.style.left = `${left - sceneBox.scrollLeft}px`;
    box.style.top = `${below + boxH < sceneHost.offsetHeight || above < 0 ? below : above}px`;
    close.focus();
  };

  // The width the forest was last laid out for
  let drawnWidth = 0;
  const drawScene = () => {
    closePopover();
    const season = state.season ?? autoSeason;
    seasonBtns.forEach((b, i) => {
      b.toggleClass("is-active", SEASONS[i] === season);
      b.setAttr("aria-pressed", String(SEASONS[i] === season));
    });
    const width = Math.max(320, sceneBox.clientWidth || 900);
    drawnWidth = sceneBox.clientWidth;
    const layout = layoutForest(forest, width, { rtl, view: state.view });
    const old = forest.old;
    handle = renderForestScene(sceneHost, layout, {
      season,
      dark,
      zoom: state.zoom,
      fresh,
      caption: state.view === "old"
        ? { title: "The old forest", sub: "Finished and stopped projects. Their trees stay." }
        : { title: captionFor(range, ctx.periodLabel, ctx.period.atToday), sub: "Small steps. Lasting growth." },
      describeGrove: (grove, hidden) => groveCardMeta(grove, hidden, during),
      selected: selectedGrove()?.key ?? null,
      onTree: openTree,
      onGrove: (grove) => select(grove, false),
      corner: old.length
        ? {
            title: "Old forest",
            sub: count(old.length, "project"),
            lines: [
              ...old.slice(0, 3).map((g) => `${g.title} · ${g.state === "finished" ? "Finished" : "Stopped"} · ${formatHours(g.totalHours)} total`),
              ...(old.length > 3 ? [`and ${old.length - 3} more`] : []),
            ],
            onOpen: () => { state.view = "old"; ctx.refresh(); },
          }
        : null,
      looseLabel: state.view === "active" && forest.loose
        ? ["No project", treeCounts(forest.loose), forest.loose.hours ? formatHours(forest.loose.hours) : ""].filter(Boolean).join(" · ")
        : "",
      empty: layout.groves.length || layout.loose.length || layout.corner
        ? null
        : [`Nothing planted ${during}`, "Finish a task to plant a tree. Time put into an open task grows a sprout."],
    });
    fresh = new Set();
    drawLegend(legend, season, dark);
  };

  const drawSide = () => drawSidePanel(plugin, side, ctx, forest, state, {
    list: everyGrove(),
    selected: selectedGrove(),
    during,
    projectFile,
    onPick: (grove) => select(grove, true),
    redraw: () => drawSide(),
  });

  drawScene();
  drawSide();

  // Laid out again when the pane is resized enough to change the rows
  const observer = new ResizeObserver(() => {
    if (!sceneBox.isConnected) { observer.disconnect(); return; }
    const width = sceneBox.clientWidth;
    // Any change: a scroll bar coming or going is enough to push the edge out of sight
    if (width && Math.abs(width - drawnWidth) > 4) drawScene();
  });
  observer.observe(sceneBox);
}

const KIND_NAME: Record<ForestTree["kind"], string> = { sprout: "Sprout", sapling: "Sapling", young: "Young tree", old: "Mature tree" };
const KIND_NOTE: Record<ForestTree["kind"], string> = {
  sprout: "Open task · worked on this period",
  sapling: "Completed task · under 1h tracked",
  young: "Completed task · 1 to 5h tracked",
  old: "Completed task · more than 5h tracked",
};

function captionFor(range: PeriodRange, label: string, atToday: boolean): string {
  if (range === "all") return "Your whole forest";
  // Kept apart, so a Jalali date reads right inside the English
  const at = `\u2068${label}\u2069`;
  if (range === "week") return atToday ? "This week's forest" : `The forest of ${at}`;
  return `The ${at} forest`;
}

function drawLegend(legend: HTMLElement, season: Season, dark: boolean): void {
  legend.empty();
  const head = legend.createDiv({ cls: "pm-forest-legend-head" });
  head.createSpan({ cls: "pm-forest-legend-title", text: "How your forest grows" });
  head.createSpan({ cls: "pm-forest-legend-note", text: "Completed tasks grow trees. Open tasks sprout." });
  const row = legend.createDiv({ cls: "pm-forest-legend-items" });
  const item = (kind: Parameters<typeof drawLegendTree>[1], name: string, note: string) => {
    const it = row.createDiv({ cls: "pm-forest-legend-item" });
    drawLegendTree(it, kind, season, dark);
    const words = it.createDiv();
    words.createDiv({ cls: "pm-forest-legend-name", text: name });
    words.createDiv({ cls: "pm-forest-legend-sub", text: note });
  };
  item("sprout", "Sprout", "Open · worked this period");
  item("sapling", "Sapling", "Completed · under 1h");
  item("young", "Young tree", "Completed · 1–5h");
  item("old", "Mature tree", "Completed · over 5h");
  item("flower", "Flower", "1 pomodoro session");
}

// ── Side panel ──────────────────────────────────────────────────────────

function drawSidePanel(
  plugin: ProjectManagerPlugin,
  side: HTMLElement,
  ctx: DashboardContext,
  forest: Forest,
  state: ForestState,
  o: {
    list: Grove[];
    selected: Grove | null;
    during: string;
    projectFile: (key: string) => TFile | null;
    onPick: (grove: Grove) => void;
    redraw: () => void;
  }
): void {
  side.empty();
  const today = todayISO();
  const cal = plugin.calendar;

  // ── Project groves ──
  const card = side.createDiv({ cls: "pm-forest-panel" });
  const head = card.createDiv({ cls: "pm-forest-panel-head" });
  head.createDiv({ cls: "pm-forest-panel-title", text: state.view === "old" ? "Old groves" : "Project groves" });
  const sort = head.createEl("button", { cls: "pm-forest-icon-btn", attr: { "aria-label": "Order of groves" } });
  setIcon(sort, "sliders-horizontal");
  sort.addEventListener("click", (e) => {
    const menu = new Menu();
    const choice = (order: GroveOrder, title: string) =>
      menu.addItem((i) => i.setTitle(title).setChecked(state.order === order).onClick(() => { state.order = order; o.redraw(); }));
    choice("forest", "As in the forest");
    choice("hours", "Most hours");
    choice("name", "Name");
    menu.showAtMouseEvent(e);
  });
  card.createDiv({ cls: "pm-forest-panel-sub", text: `${ctx.periodLabel} · tracked time in this period` });

  const rows = o.list.filter((g) => g.state !== "loose");
  if (state.order === "hours") rows.sort((a, b) => b.hours - a.hours || b.totalHours - a.totalHours);
  if (state.order === "name") rows.sort((a, b) => a.title.localeCompare(b.title));
  const list = card.createDiv({ cls: "pm-forest-groves" });
  const row = (grove: Grove, parent: HTMLElement) => {
    const r = parent.createDiv({ cls: `pm-forest-grove-row is-${grove.state}`, attr: { role: "button", tabindex: "0" } });
    if (o.selected?.key === grove.key) r.addClass("is-selected");
    r.setCssProps({ "--pm-project-color": grove.state === "meadow" || grove.state === "loose" ? "#9aa0a6" : projectColor(grove.key) });
    if (grove.state === "loose") {
      setIcon(r.createSpan({ cls: "pm-forest-road-icon" }), "route");
    }
    const words = r.createDiv({ cls: "pm-forest-grove-words" });
    const line = words.createDiv({ cls: "pm-forest-grove-line" });
    if (grove.state !== "loose") line.createSpan({ cls: "pm-forest-dot" });
    line.createSpan({ cls: "pm-forest-grove-name", text: grove.state === "loose" ? "Along the road" : grove.title });
    if (grove.pinned) setIcon(line.createSpan({ cls: "pm-forest-grove-pin" }), "pin");
    if (o.selected?.key === grove.key && grove.state !== "loose") setIcon(line.createSpan({ cls: "pm-forest-grove-chevron" }), "chevron-right");
    const meta = words.createDiv({ cls: "pm-forest-grove-meta" });
    meta.createSpan({ text: groveListMeta(grove, today) });
    meta.createSpan({ cls: "pm-forest-grove-hours", text: grove.state === "finished" || grove.state === "stopped" ? formatHours(grove.totalHours) : formatHours(grove.hours) });
    const pick = () => o.onPick(grove);
    r.addEventListener("click", pick);
    r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  };
  for (const g of rows) row(g, list);
  if (!rows.length) list.createDiv({ cls: "pm-forest-panel-empty", text: "No groves in this period yet." });
  const loose = o.list.find((g) => g.state === "loose");
  if (loose) row(loose, card.createDiv({ cls: "pm-forest-road" }));

  // ── The grove picked ──
  const g = o.selected;
  if (g) {
    const sel = side.createDiv({ cls: "pm-forest-panel pm-forest-selected" });
    const top = sel.createDiv({ cls: "pm-forest-panel-head" });
    top.createDiv({ cls: "pm-forest-panel-kicker", text: "Selected grove" });
    const file = o.projectFile(g.key);
    if (file) {
      const pin = top.createEl("button", {
        cls: `pm-forest-icon-btn${g.pinned ? " is-on" : ""}`,
        attr: { "aria-label": g.pinned ? "Unpin" : "Pin to the top", "aria-pressed": String(g.pinned) },
      });
      setIcon(pin, "pin");
      pin.addEventListener("click", async () => {
        await plugin.toggleProjectPinned(ctx.ws, g.key);
        ctx.refresh();
      });
    }
    sel.createDiv({ cls: "pm-forest-selected-name", text: g.state === "loose" ? "Along the road" : g.title });
    const about = sel.createDiv({ cls: "pm-forest-selected-about" });
    if (g.state === "loose") about.setText("Tasks with no project, standing by the road.");
    else if (g.state === "meadow") about.setText(g.members.join(", "));
    else if (file) void describeProject(plugin, file).then((text) => { if (text) about.setText(text); else about.remove(); });
    const nums = sel.createDiv({ cls: "pm-forest-selected-nums" });
    const num = (value: string, label: string, icon?: string) => {
      const n = nums.createDiv();
      const v = n.createDiv({ cls: "pm-forest-selected-value", text: value });
      if (icon) setIcon(v.createSpan({ cls: "pm-forest-selected-icon" }), icon);
      n.createDiv({ cls: "pm-forest-selected-label", text: label });
    };
    const resting = g.state === "idle" || g.state === "finished" || g.state === "stopped";
    num(formatHours(resting ? g.totalHours : g.hours), resting ? "tracked in all" : `tracked ${o.during}`);
    num(String(g.flowers), g.flowers === 1 ? "pomodoro session" : "pomodoro sessions", "flower-2");
    if (g.latest) {
      const latest = g.latest;
      sel.createDiv({ cls: "pm-forest-panel-kicker pm-forest-latest-head", text: `Latest tree · ${cal.label(latest.completed)}` });
      const l = sel.createDiv({ cls: "pm-forest-latest", attr: { role: "link", tabindex: "0" } });
      setIcon(l.createSpan(), "circle-check");
      l.createSpan({ text: latest.title });
      const open = () => {
        const f = plugin.app.vault.getAbstractFileByPath(latest.path);
        if (f instanceof TFile) plugin.openTaskModal(f, ctx.ws);
      };
      l.addEventListener("click", open);
      l.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    }
    if (file) {
      const btn = sel.createEl("button", { cls: "pm-forest-open" });
      btn.createSpan({ text: "Open project" });
      setIcon(btn.createSpan(), "arrow-up-right");
      btn.addEventListener("click", () => plugin.openProjectModal(file, ctx.ws));
    }
  }

  // ── A word on the resting ──
  const rest = side.createDiv({ cls: "pm-forest-resting" });
  setIcon(rest.createSpan({ cls: "pm-forest-resting-icon" }), "leaf");
  const words = rest.createDiv();
  words.createDiv({ cls: "pm-forest-resting-title", text: "Resting, not forgotten." });
  words.createDiv({ text: `Groves turn warm after ${IDLE_DAYS} days without activity. Your trees stay with you.` });
}

/** The project's `description`, or else the first lines written in its note */
async function describeProject(plugin: ProjectManagerPlugin, file: TFile): Promise<string> {
  const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
  if (typeof fm?.description === "string" && fm.description.trim()) return fm.description.trim();
  let text: string;
  try { text = await plugin.app.vault.cachedRead(file); } catch { return ""; }
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("|") || t.startsWith("```") || t.startsWith(">")) continue;
    const plain = t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_`]/g, "");
    return plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
  }
  return "";
}

// ── Words ───────────────────────────────────────────────────────────────

function groveCardMeta(grove: Grove, hidden: number, during: string): string {
  let meta: string;
  if (grove.state === "idle") meta = `${during === "in all" ? "Resting" : `No activity ${during}`} · ${formatHours(grove.totalHours)} total`;
  else if (grove.state === "finished" || grove.state === "stopped") meta = `${treeCounts(grove)} · ${formatHours(grove.totalHours)} total`;
  else if (grove.state === "meadow") meta = `${count(grove.members.length, "small project")} · ${treeCounts(grove)}`;
  else meta = [treeCounts(grove), grove.hours ? formatHours(grove.hours) : ""].filter(Boolean).join(" · ");
  return hidden ? `${meta} · ${hidden} not drawn` : meta;
}

function groveListMeta(grove: Grove, today: string): string {
  if (grove.state === "idle") return `Idle · ${daysBetween(grove.lastActive, today)} days inactive`;
  if (grove.state === "finished") return `Finished · ${treeCounts(grove)}`;
  if (grove.state === "stopped") return `Stopped · ${treeCounts(grove)}`;
  if (grove.state === "loose") return `No project · ${treeCounts(grove)}`;
  return treeCounts(grove);
}

function treeCounts(grove: Grove): string {
  const trees = grove.trees.filter((t) => t.kind !== "sprout").length;
  const sprouts = grove.trees.length - trees;
  return [count(trees, "tree"), sprouts ? count(sprouts, "sprout") : ""].filter(Boolean).join(" · ");
}

function allTrees(forest: Forest): ForestTree[] {
  return [...forest.groves, ...forest.old, ...(forest.loose ? [forest.loose] : [])].flatMap((g) => g.trees);
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
