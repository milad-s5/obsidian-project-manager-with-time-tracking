// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Forest                                                              ║
// ║  A dashboard tab where finished tasks grow as trees, each project    ║
// ║  a grove, for the period picked in the toolbar. Drawn from the same  ║
// ║  data as the Overview; nothing is written to the vault.              ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Setting, TFile } from "obsidian";
import type ProjectManagerPlugin from "../main";
import type { DashboardContext, DashboardTab } from "../core/Extensions";
import { Forest, ForestTree, Grove, buildForest, layoutForest, seasonOf } from "../utils/Forest";
import { drawLegendFlower, drawLegendTree, flashGrove, renderForestScene } from "../views/ForestScene";
import { ChartTooltip, ColumnPoint, chartCard, columnChart, formatHours, heroFigure } from "../views/DashboardCharts";
import { addDays, daysBetween, rangeDays, todayISO } from "../utils/Jalali";
import { isDoneStatus } from "../managers/AnalyticsManager";
import { projectColor } from "../utils/StatusColors";

export function setupForest(plugin: ProjectManagerPlugin): void {
  // The trees each period last showed, so the ones planted since grow in
  const seen = new Map<string, Set<string>>();
  const tab: DashboardTab = {
    id: "forest",
    label: () => "Forest",
    render: (root, ctx) => renderForestTab(plugin, root, ctx, seen),
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

function renderForestTab(
  plugin: ProjectManagerPlugin,
  root: HTMLElement,
  ctx: DashboardContext,
  seen: Map<string, Set<string>>
): void {
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

  // A short period shows its own season; a year or more shows today's
  const span = daysBetween(ctx.from, ctx.to);
  const seasonDay = span > 100 ? today : addDays(ctx.from, Math.floor(span / 2));
  const season = seasonOf(cal.fromISO(seasonDay).m, cal.kind);
  const dark = document.body.hasClass("theme-dark");
  const rtl = plugin.settings.boardDirection === "rtl";

  const planted = new Set(allTrees(forest).filter((t) => t.kind !== "sprout").map((t) => t.path));
  const key = `${ctx.ws.id}|${ctx.from}|${ctx.to}`;
  const before = seen.get(key);
  const fresh = before ? new Set([...planted].filter((p) => !before.has(p))) : new Set<string>();
  seen.set(key, planted);

  // The outer box is what the layout measures to go one above the other
  const wrap = root.createDiv({ cls: "pm-forest-box" }).createDiv({ cls: "pm-forest", attr: { dir: rtl ? "rtl" : "ltr" } });
  const sceneBox = wrap.createDiv({ cls: "pm-forest-scenebox" });
  const scene = sceneBox.createDiv();
  const side = wrap.createDiv({ cls: "pm-forest-side" });

  const projectTitle = (slug: string) => (slug ? data.projectsBySlug.get(slug)?.title ?? slug : "No project");

  let drawnWidth = 0;
  let firstDraw = true;
  const draw = (width: number) => {
    drawnWidth = width;
    const layout = layoutForest(forest, width, rtl);
    renderForestScene(scene, layout, {
      season,
      dark,
      fresh: firstDraw ? fresh : new Set(),
      describeTree: (tree) => describeTree(plugin, tree, projectTitle(tree.projectSlug)),
      describeGrove: (grove, hidden) => describeGrove(grove, hidden, today),
      onTree: (tree) => {
        const file = plugin.app.vault.getAbstractFileByPath(tree.path);
        if (file instanceof TFile) plugin.openTaskModal(file, ctx.ws);
      },
      onGrove: (grove) => {
        const project = data.projectsBySlug.get(grove.key);
        if (project) plugin.openProjectModal(project.file, ctx.ws);
      },
      empty: forest.planted + forest.sprouts
        ? null
        : [`Nothing planted · ${ctx.periodLabel}`, "Finish a task to plant a tree. Time put into an open task grows a sprout."],
      looseLabel: forest.loose
        ? `No project · ${groveMeta(forest.loose, today)}${layout.looseHidden ? ` · ${layout.looseHidden} not drawn` : ""}`
        : "",
    });
    firstDraw = false;
  };
  draw(sceneBox.clientWidth || 900);

  // Laid out again when the pane is resized enough to change the rows
  const observer = new ResizeObserver(() => {
    if (!sceneBox.isConnected) { observer.disconnect(); return; }
    const width = sceneBox.clientWidth;
    if (width && Math.abs(width - drawnWidth) > 40) draw(width);
  });
  observer.observe(sceneBox);

  renderSummary(plugin, side, ctx, forest);
  renderGroveList(side, forest, scene, today);
  renderLegend(side, season, dark);
}

// ── Side panel ──────────────────────────────────────────────────────────

function renderSummary(plugin: ProjectManagerPlugin, side: HTMLElement, ctx: DashboardContext, forest: Forest): void {
  const cal = plugin.calendar;
  const card = chartCard(side, "Planted", ctx.periodLabel);
  const done = ctx.data.tasks.filter((t) => isDoneStatus(t.status) && t.completed);

  // Against as many days just before, as the Overview compares
  const elapsed = Math.max(1, daysBetween(ctx.from, ctx.effTo) + 1);
  const prevTo = addDays(ctx.from, -1);
  const prevFrom = addDays(prevTo, -(elapsed - 1));
  const before = done.filter((t) => t.completed >= prevFrom && t.completed <= prevTo).length;
  const diff = forest.planted - before;

  heroFigure(card.body, {
    label: "Trees",
    value: String(forest.planted),
    unit: forest.planted === 1 ? "tree" : "trees",
    sub: [`${formatHours(forest.hours)} of work`, forest.sprouts ? `${forest.sprouts} still growing` : ""].filter(Boolean).join(" · "),
    delta: forest.planted || before
      ? { text: `${Math.abs(diff)} vs previous ${elapsed}d`, direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat" }
      : undefined,
  });

  // Trees planted per day, week, month or year, whichever fits the period
  const span = daysBetween(ctx.from, ctx.to) + 1;
  const buckets = new Map<string, ColumnPoint>();
  for (const iso of rangeDays(ctx.from, ctx.to)) {
    const { y, m, d } = cal.fromISO(iso);
    let k: string;
    let axis: string;
    let title: string;
    if (span <= 7) { k = iso; axis = cal.digits(d); title = cal.dayTitle(iso); }
    else if (span <= 31) { k = cal.startOfWeek(iso); axis = cal.digits(cal.fromISO(k).d); title = cal.weekLabel(k); }
    else if (span <= 400) { k = `${y}-${m}`; axis = cal.monthsShort[m - 1]; title = cal.monthLabel(y, m); }
    else { k = String(y); axis = cal.digits(y); title = cal.yearLabel(iso); }
    if (!buckets.has(k)) buckets.set(k, { key: k, axisLabel: axis, tipLines: [title], value: 0 });
    if (iso <= ctx.effTo) {
      const p = buckets.get(k);
      if (p) p.value += done.filter((t) => t.completed === iso).length;
    }
  }
  const points = [...buckets.values()];
  for (const p of points) p.tipLines = [p.tipLines[0], count(p.value, "tree")];
  if (points.length > 1) {
    card.body.createDiv({ cls: "pm-forest-chart-title", text: "Planted over time" });
    columnChart(card.body, points, ctx.tooltip as ChartTooltip);
  }
}

function renderGroveList(side: HTMLElement, forest: Forest, scene: HTMLElement, today: string): void {
  const groves = [...forest.groves, ...forest.old, ...(forest.loose ? [forest.loose] : [])];
  if (!groves.length) return;
  const card = chartCard(side, "Groves", count(groves.length, "grove"));
  const list = card.body.createDiv({ cls: "pm-forest-groves" });
  for (const grove of groves) {
    const row = list.createDiv({ cls: `pm-forest-grove-row is-${grove.state}`, attr: { role: "button", tabindex: "0" } });
    row.setCssProps({ "--pm-project-color": grove.state === "meadow" || grove.state === "loose" ? "#9aa0a6" : projectColor(grove.key) });
    row.createSpan({ cls: "pm-forest-label-dot" });
    const words = row.createDiv({ cls: "pm-forest-grove-words" });
    words.createDiv({ cls: "pm-forest-grove-name", text: grove.title });
    words.createDiv({ cls: "pm-forest-grove-meta", text: groveMeta(grove, today) });
    // Tasks with no project stand by the road, at the top
    const go = () => (grove.state === "loose" ? scene.scrollIntoView({ block: "start", behavior: "smooth" }) : flashGrove(scene, grove.key));
    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  card.setTable(
    ["Grove", "Trees", "Growing", "Hours", "State"],
    groves.map((g) => [
      g.title,
      g.trees.filter((t) => t.kind !== "sprout").length,
      g.trees.filter((t) => t.kind === "sprout").length,
      formatHours(g.hours),
      g.state,
    ])
  );
}

function renderLegend(side: HTMLElement, season: ReturnType<typeof seasonOf>, dark: boolean): void {
  const card = chartCard(side, "Legend");
  const list = card.body.createDiv({ cls: "pm-forest-legend" });
  const row = (draw: (el: HTMLElement) => void, text: string) => {
    const r = list.createDiv({ cls: "pm-forest-legend-row" });
    draw(r);
    r.createSpan({ text });
  };
  row((el) => drawLegendTree(el, "sprout", season, dark), "Sprout: an open task with time in this period");
  row((el) => drawLegendTree(el, "sapling", season, dark), "Sapling: a finished task, under 1 hour");
  row((el) => drawLegendTree(el, "young", season, dark), "Young tree: 1 to 5 hours");
  row((el) => drawLegendTree(el, "old", season, dark), "Old tree: over 5 hours");
  row((el) => drawLegendFlower(el), "Flower: a pomodoro");
  row((el) => drawLegendTree(el, "cabin", season, dark), "Cabin: a finished project");
  row((el) => drawLegendTree(el, "idle", season, dark), "Tall grass: no work for 3 weeks");
}

// ── Words ───────────────────────────────────────────────────────────────

function describeTree(plugin: ProjectManagerPlugin, tree: ForestTree, project: string): string[] {
  const size = { sprout: "sprout", sapling: "sapling", young: "young tree", old: "old tree" }[tree.kind];
  return [
    tree.title,
    `${project} · ${formatHours(tree.hours)}`,
    tree.kind === "sprout" ? "Still growing: not done yet" : `Done ${plugin.calendar.label(tree.completed)} · ${size}`,
  ];
}

function describeGrove(grove: Grove, hidden: number, today: string): string {
  const meta = groveMeta(grove, today);
  return hidden ? `${meta} · ${hidden} not drawn` : meta;
}

function groveMeta(grove: Grove, today: string): string {
  const trees = grove.trees.filter((t) => t.kind !== "sprout").length;
  const growing = grove.trees.length - trees;
  const parts = [count(trees, "tree")];
  if (growing) parts.push(`${growing} growing`);
  if (grove.state === "finished") parts.push("finished ✓");
  else if (grove.state === "stopped") parts.push("stopped");
  else if (grove.state === "idle") parts.push(`idle ${Math.max(3, Math.floor(daysBetween(grove.lastActive, today) / 7))} wk`);
  else if (grove.state === "meadow") parts.unshift(count(grove.members.length, "small project"));
  else parts.push(formatHours(grove.hours));
  return parts.join(" · ");
}

function allTrees(forest: Forest): ForestTree[] {
  return [...forest.groves, ...forest.old, ...(forest.loose ? [forest.loose] : [])].flatMap((g) => g.trees);
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
