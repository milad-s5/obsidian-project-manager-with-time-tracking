import { ItemView, WorkspaceLeaf, TFile, Menu, Notice } from "obsidian";
import { updateFrontmatterFields } from "../utils/FrontmatterUtils";
import ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { statusColor, priorityColor, isMutedStatus } from "../utils/StatusColors";
import { NoteInfo, renderNoteBadge } from "../utils/NoteContent";
import { renderTimerBar, tickTimerDisplays } from "./TimerBar";
import {
  AnalyticsData, TimeRecord, TaskInfo, ProjectInfo,
  currentStreak, groupHoursBy, hoursPerDay, isClosedStatus, isDoneStatus,
  longestStreak, recordsInRange, sumHours,
} from "../managers/AnalyticsManager";
import {
  BarRow, CalendarMode, ChartTooltip, ColumnPoint, StackSegment,
  barListChart, chartCard, columnChart, formatHours, formatNumber, heatLegend,
  dayTitle, heroFigure, renderCalendar, stackedBar, statTile,
} from "./DashboardCharts";
import { addDays, daysBetween, rangeDays, todayISO } from "../utils/Jalali";

export const PROJECT_DASHBOARD_VIEW_TYPE = "project-manager-project-dashboard";

type TabId = "overview" | "calendar" | "projects";
type RangeId = "week" | "month" | "season" | "year" | "all";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "calendar", label: "Calendar" },
  { id: "projects", label: "Projects" },
];

const RANGES: { id: RangeId; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "season", label: "This season" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

interface RangeBounds {
  from: string;
  to: string;
  /** Effective end for the statistics — never runs past today */
  effTo: string;
  prevFrom: string;
  prevTo: string;
  label: string;
  calMode: CalendarMode;
}

export class ProjectDashboardView extends ItemView {
  plugin: ProjectManagerPlugin;
  currentWorkspace: Workspace;
  filterStatus = "";
  filterPriority = "";

  private tab: TabId = "projects";
  private range: RangeId = "month";
  /** The day the range is computed around. The ◀ ▶ arrows move it, so nothing is
   *  pinned to "today" any more and past months and years can be seen. */
  private anchor: string = todayISO();
  private selectedDay: string | null = null;
  /** Paths of projects holding text beyond the template → marker on the card */
  private noted: Map<string, NoteInfo> = new Map();
  private tooltip: ChartTooltip | null = null;
  private refreshInterval: number | null = null;
  private renderTimer: number | null = null;
  private scrollTop = 0;

  constructor(leaf: WorkspaceLeaf, plugin: ProjectManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentWorkspace = plugin.getCurrentWorkspace();
  }

  getViewType(): string { return PROJECT_DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return "Project Dashboard"; }
  getIcon(): string { return "folder-open"; }

  async onOpen(): Promise<void> {
    await this.render();

    this.refreshInterval = window.setInterval(() => {
      if (this.plugin.timeTracker.isTicking()) {
        tickTimerDisplays(this.containerEl, this.plugin);
      }
    }, 1000);

    // Re-render on any vault change, but debounced: one save fires several events
    // in a row and a full dashboard render is not cheap.
    //
    // "changed" rather than vault "modify": modify fires as soon as bytes are
    // written, before the frontmatter has been re-parsed, so a render at that
    // point reads the old values and sticks with them.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRender()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRender()));
  }

  async onClose(): Promise<void> {
    if (this.refreshInterval !== null) clearInterval(this.refreshInterval);
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.render();
    }, 250);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════════════════════════

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    const prevScroll = container.querySelector<HTMLElement>(".pm-db-scroll");
    if (prevScroll) this.scrollTop = prevScroll.scrollTop;

    container.empty();
    container.addClass("pm-dashboard-container");
    this.tooltip = new ChartTooltip(container);

    this.renderToolbar(container);
    this.renderTabs(container);

    const scroll = container.createDiv({ cls: "pm-db-scroll" });
    const data = await this.plugin.analytics.collect(this.currentWorkspace);

    if (this.tab === "overview") this.renderOverview(scroll, data);
    else if (this.tab === "calendar") this.renderCalendarTab(scroll, data);
    else {
      this.noted = await this.plugin.noteScanner.scan(data.projects.map((p) => p.file));
      this.renderProjectsTab(scroll, data);
    }

    scroll.scrollTop = this.scrollTop;
  }

  // ── Toolbar and tabs ────────────────────────────────────────────────

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "pm-toolbar" });

    const wsSelect = toolbar.createEl("select", { cls: "pm-ws-select" });
    this.plugin.settings.workspaces.forEach((ws) => {
      const opt = wsSelect.createEl("option", { value: ws.id, text: ws.name });
      if (ws.id === this.currentWorkspace.id) opt.selected = true;
    });
    wsSelect.addEventListener("change", async () => {
      const ws = this.plugin.settings.workspaces.find((w) => w.id === wsSelect.value);
      if (!ws) return;
      this.currentWorkspace = ws;
      this.plugin.settings.defaultWorkspaceId = ws.id;
      this.selectedDay = null;
      this.scrollTop = 0;
      await this.plugin.saveSettings();
      await this.render();
    });

    const rangeSelect = toolbar.createEl("select", { cls: "pm-filter-select" });
    RANGES.forEach((r) => {
      const opt = rangeSelect.createEl("option", { value: r.id, text: r.label });
      if (r.id === this.range) opt.selected = true;
    });
    rangeSelect.addEventListener("change", async () => {
      this.range = rangeSelect.value as RangeId;
      await this.render();
    });

    // Period navigation — only where a period means anything
    if (this.tab !== "projects") this.renderPeriodNav(toolbar);

    // Status and priority filters only narrow the projects tab, so they show only there
    if (this.tab === "projects") {
      const statusSelect = toolbar.createEl("select", { cls: "pm-filter-select" });
      statusSelect.createEl("option", { value: "", text: "All statuses" });
      this.plugin.settings.statuses.forEach((status) => {
        const opt = statusSelect.createEl("option", { value: status, text: status });
        if (status === this.filterStatus) opt.selected = true;
      });
      statusSelect.addEventListener("change", async () => {
        this.filterStatus = statusSelect.value;
        await this.render();
      });

      const prioSelect = toolbar.createEl("select", { cls: "pm-filter-select" });
      prioSelect.createEl("option", { value: "", text: "All priorities" });
      this.plugin.settings.priorities.forEach((p) => {
        const opt = prioSelect.createEl("option", { value: p, text: p });
        if (p === this.filterPriority) opt.selected = true;
      });
      prioSelect.addEventListener("change", async () => {
        this.filterPriority = prioSelect.value;
        await this.render();
      });
    }

    toolbar.createEl("button", { cls: "pm-btn pm-btn-primary", text: "+ New Task" })
      .addEventListener("click", () => this.plugin.openNewTaskModal(this.currentWorkspace));

    toolbar.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "+ New Project" })
      .addEventListener("click", () => this.plugin.openNewProjectModal(this.currentWorkspace));

    toolbar.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Kanban" })
      .addEventListener("click", () => this.plugin.openKanban());

    renderTimerBar(toolbar, this.plugin, this.currentWorkspace, () => void this.render());
  }

  /** ◀ period label ▶ plus Today — separates the period from "today" */
  private renderPeriodNav(toolbar: HTMLElement): void {
    const nav = toolbar.createDiv({ cls: "pm-db-nav" });
    // "All time" is the whole range already; there is nowhere to step to
    const navigable = this.range !== "all";

    const prev = nav.createEl("button", { cls: "pm-db-navbtn", text: "‹" });
    prev.setAttribute("aria-label", "Previous period");
    prev.disabled = !navigable;
    prev.addEventListener("click", () => this.shiftAnchor(-1));

    nav.createDiv({ cls: "pm-db-navlabel", text: this.periodLabel() });

    const next = nav.createEl("button", { cls: "pm-db-navbtn", text: "›" });
    next.setAttribute("aria-label", "Next period");
    next.disabled = !navigable;
    next.addEventListener("click", () => this.shiftAnchor(1));

    const todayBtn = nav.createEl("button", { cls: "pm-db-navtoday", text: "Today" });
    todayBtn.disabled = !navigable || this.anchor === todayISO();
    todayBtn.addEventListener("click", () => {
      this.anchor = todayISO();
      this.selectedDay = null;
      this.scrollTop = 0;
      void this.render();
    });
  }

  /** Period label without needing data — required before collect runs */
  private periodLabel(): string {
    const cal = this.plugin.calendar;
    const { y, m } = cal.fromISO(this.anchor);
    switch (this.range) {
      case "week": return cal.weekLabel(cal.startOfWeek(this.anchor));
      case "season": return cal.seasonLabel(this.anchor);
      case "year": return cal.yearLabel(this.anchor);
      case "all": return "All time";
      default: return cal.monthLabel(y, m);
    }
  }

  private shiftAnchor(dir: -1 | 1): void {
    if (this.range === "week") {
      this.anchor = addDays(this.anchor, dir * 7);
    } else {
      const step = this.range === "season" ? 3 : this.range === "year" ? 12 : 1;
      this.anchor = this.plugin.calendar.shiftMonths(this.anchor, dir * step);
    }
    this.selectedDay = null;
    this.scrollTop = 0;
    void this.render();
  }

  private renderTabs(container: HTMLElement): void {
    const tabs = container.createDiv({ cls: "pm-db-tabs" });
    for (const t of TABS) {
      const btn = tabs.createEl("button", {
        cls: `pm-db-tab${t.id === this.tab ? " is-active" : ""}`,
        text: t.label,
      });
      btn.setAttribute("aria-pressed", String(t.id === this.tab));
      btn.addEventListener("click", async () => {
        if (this.tab === t.id) return;
        this.tab = t.id;
        this.scrollTop = 0;
        await this.render();
      });
    }
  }

  // ── Range arithmetic ────────────────────────────────────────────────

  private bounds(data: AnalyticsData): RangeBounds {
    const today = todayISO();
    const anchor = this.anchor;
    const cal = this.plugin.calendar;
    const { y: jy, m: jm } = cal.fromISO(anchor);
    let from: string;
    let to: string;
    let label: string;
    let calMode: CalendarMode;

    switch (this.range) {
      case "week": {
        from = cal.startOfWeek(anchor);
        to = addDays(from, 6);
        label = cal.weekLabel(from);
        calMode = "dots";
        break;
      }
      case "season": {
        from = cal.startOfSeason(anchor);
        const lastMonth = Math.floor((jm - 1) / 3) * 3 + 3;
        to = cal.toISO(jy, lastMonth, cal.monthLength(jy, lastMonth));
        label = cal.seasonLabel(anchor);
        calMode = "grid";
        break;
      }
      case "year": {
        from = cal.startOfYear(anchor);
        to = cal.toISO(jy, 12, cal.monthLength(jy, 12));
        label = cal.yearLabel(anchor);
        calMode = "heatmap";
        break;
      }
      case "all": {
        from = data.firstISO ?? cal.startOfYear(today);
        to = data.lastISO && data.lastISO > today ? data.lastISO : today;
        label = "All time";
        calMode = "heatmap";
        break;
      }
      default: {
        from = cal.startOfMonth(anchor);
        to = cal.toISO(jy, jm, cal.monthLength(jy, jm));
        label = cal.monthLabel(jy, jm);
        calMode = "grid";
      }
    }

    // A past range is fully elapsed and a future one not at all — "today" only
    // ever splits the current range
    const effTo = from > today ? to : to > today ? today : to;
    // The previous period spans exactly as many days as have elapsed in this one,
    // not the whole period; otherwise a half-done month always loses to a full one.
    const elapsed = Math.max(1, daysBetween(from, effTo) + 1);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(elapsed - 1));

    return { from, to, effTo, prevFrom, prevTo, label, calMode };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Overview tab
  // ══════════════════════════════════════════════════════════════════════

  private renderOverview(root: HTMLElement, data: AnalyticsData): void {
    const b = this.bounds(data);
    const inRange = recordsInRange(data.records, b.from, b.effTo);
    const prev = recordsInRange(data.records, b.prevFrom, b.prevTo);
    const days = rangeDays(b.from, b.effTo);
    const perDay = hoursPerDay(inRange, days);

    const total = sumHours(inRange);
    const prevTotal = sumHours(prev);
    const activeDays = days.filter((d) => (perDay.get(d) ?? 0) > 0).length;
    const openTasks = data.tasks.filter((t) => !isClosedStatus(t.status));
    const today = todayISO();
    const overdue = openTasks.filter((t) => t.due && t.due < today);

    // ── First line: one hero figure plus tiles ──
    const headline = root.createDiv({ cls: "pm-db-headline" });
    const diff = Math.round((total - prevTotal) * 100) / 100;
    heroFigure(headline, {
      label: `Time tracked · ${b.label}`,
      value: formatNumber(total),
      unit: "hours",
      sub: `${b.from} → ${b.effTo}  ·  ${this.plugin.calendar.rangeLabel(b.from, b.effTo)}`,
      delta: prevTotal > 0 || total > 0
        ? {
            text: `${formatHours(Math.abs(diff))} vs previous ${days.length}d`,
            direction: diff > 0.01 ? "up" : diff < -0.01 ? "down" : "flat",
          }
        : undefined,
    });

    const tiles = headline.createDiv({ cls: "pm-db-tiles" });
    statTile(tiles, {
      label: "Active days",
      value: String(activeDays),
      unit: `/ ${days.length}`,
      sub: `${Math.round((activeDays / Math.max(1, days.length)) * 100)}% of the period`,
    });
    statTile(tiles, {
      label: "Avg / active day",
      value: formatNumber(activeDays ? Math.round((total / activeDays) * 10) / 10 : 0),
      unit: "h",
      sub: activeDays ? `over ${activeDays} day${activeDays === 1 ? "" : "s"}` : "nothing logged yet",
    });
    const streak = currentStreak(data.byDay);
    statTile(tiles, {
      label: "Current streak",
      value: String(streak),
      unit: streak === 1 ? "day" : "days",
      sub: `longest ${longestStreak(data.byDay)} days`,
    });
    statTile(tiles, {
      label: "Open tasks",
      value: String(openTasks.length),
      sub: `${data.tasks.filter((t) => isDoneStatus(t.status)).length} done of ${data.tasks.length}`,
    });
    statTile(tiles, {
      label: "Overdue",
      value: String(overdue.length),
      tone: overdue.length ? "critical" : "default",
      sub: overdue.length ? "past their due date" : "nothing past due",
    });

    // ── Cards ──
    const cards = root.createDiv({ cls: "pm-db-cards pm-db-cards-spaced" });
    this.renderHoursChart(cards, b, inRange, days, perDay);
    this.renderProjectHoursChart(cards, data, inRange);
    this.renderTaskHoursChart(cards, data, inRange, b);
    this.renderStatusChart(cards, data);
    this.renderPriorityChart(cards, openTasks);
    this.renderAttentionCard(cards, openTasks, today);
    this.renderRecentCard(cards, data, inRange);
  }

  private renderHoursChart(
    parent: HTMLElement, b: RangeBounds, inRange: TimeRecord[],
    days: string[], perDay: Map<string, number>
  ): void {
    // Past 45 columns they turn hair-thin and labels collide — weekly from there on
    const weekly = days.length > 45;
    const points: ColumnPoint[] = [];

    if (weekly) {
      const buckets = new Map<string, { start: string; end: string; hours: number }>();
      for (const iso of days) {
        const start = this.plugin.calendar.startOfWeek(iso);
        const bucket = buckets.get(start) ?? { start, end: iso, hours: 0 };
        bucket.end = iso;
        bucket.hours += perDay.get(iso) ?? 0;
        buckets.set(start, bucket);
      }
      for (const bucket of buckets.values()) {
        const { d: jd, m: jm } = this.plugin.calendar.fromISO(bucket.start);
        points.push({
          key: bucket.start,
          axisLabel: this.plugin.calendar.digits(jd),
          value: Math.round(bucket.hours * 100) / 100,
          tipLines: [
            this.plugin.calendar.weekLabel(bucket.start),
            `${formatHours(bucket.hours)} tracked`,
            `${bucket.start} → ${bucket.end}`,
          ],
        });
      }
    } else {
      for (const iso of days) {
        const hours = perDay.get(iso) ?? 0;
        points.push({
          key: iso,
          axisLabel: this.plugin.calendar.digits(this.plugin.calendar.fromISO(iso).d),
          value: hours,
          tipLines: [dayTitle(this.plugin.calendar, iso), `${formatHours(hours)} tracked`, iso],
        });
      }
    }

    const card = chartCard(
      parent,
      weekly ? "Hours per week" : "Hours per day",
      `${b.label} · ${weekly ? "grouped by Jalali week" : "one column per day"}`
    );
    card.root.addClass("pm-db-wide");

    if (!inRange.length) {
      card.body.createDiv({ cls: "pm-db-empty", text: "No time logged in this period yet." });
      return;
    }

    columnChart(card.body, points, this.tooltip!, (p) => {
      this.selectedDay = p.key;
      this.tab = "calendar";
      this.scrollTop = 0;
      void this.render();
    });

    card.setTable(
      ["Date (Jalali)", "Date", "Hours"],
      points.map((p) => [
        weekly ? this.plugin.calendar.weekLabel(p.key) : this.plugin.calendar.label(p.key),
        p.key,
        formatHours(p.value),
      ])
    );
  }

  private renderProjectHoursChart(parent: HTMLElement, data: AnalyticsData, inRange: TimeRecord[]): void {
    const grouped = groupHoursBy(
      inRange,
      (r) => r.projectSlug || "—",
      (slug) => data.projectsBySlug.get(slug)?.title ?? (slug === "—" ? "No project" : slug)
    ).filter((g) => g.hours > 0);

    const card = chartCard(parent, "Time by project", "Where the period went");
    if (!grouped.length) {
      card.body.createDiv({ cls: "pm-db-empty", text: "No project time in this period." });
      return;
    }

    // At most 8 rows are read — the tail is folded into "Other", not given a colour
    const top = grouped.slice(0, 8);
    const rest = grouped.slice(8);
    const rows: BarRow[] = top.map((g) => ({
      label: g.label,
      value: g.hours,
      valueText: formatHours(g.hours),
      tipLines: [g.label, `${formatHours(g.hours)} in this period`],
      onClick: () => {
        const project = data.projectsBySlug.get(g.slug);
        if (project) this.plugin.openProjectModal(project.file, this.currentWorkspace);
      },
    }));
    if (rest.length) {
      const otherHours = Math.round(rest.reduce((s, g) => s + g.hours, 0) * 100) / 100;
      rows.push({
        label: `Other (${rest.length})`,
        value: otherHours,
        valueText: formatHours(otherHours),
        tipLines: [`${rest.length} more projects`, `${formatHours(otherHours)} combined`],
      });
    }

    barListChart(card.body, rows, this.tooltip!);
    card.setTable(["Project", "Hours"], grouped.map((g) => [g.label, formatHours(g.hours)]));
  }

  private renderTaskHoursChart(
    parent: HTMLElement, data: AnalyticsData, inRange: TimeRecord[], b: RangeBounds
  ): void {
    const grouped = groupHoursBy(
      inRange,
      (r) => r.taskSlug,
      (slug) => data.tasksBySlug.get(slug)?.title ?? slug
    ).filter((g) => g.hours > 0);

    const card = chartCard(parent, "Most worked tasks", `Top of ${b.label}`);
    if (!grouped.length) {
      card.body.createDiv({ cls: "pm-db-empty", text: "No task time in this period." });
      return;
    }

    const rows: BarRow[] = grouped.slice(0, 8).map((g) => {
      const task = data.tasksBySlug.get(g.slug);
      return {
        label: g.label,
        value: g.hours,
        valueText: formatHours(g.hours),
        tipLines: [
          g.label,
          `${formatHours(g.hours)} in this period`,
          task ? `${task.status} · ${task.priority}` : "task note not found",
        ],
        onClick: () => { if (task) this.plugin.openTaskModal(task.file, this.currentWorkspace); },
      };
    });

    barListChart(card.body, rows, this.tooltip!);
    card.setTable(["Task", "Hours"], grouped.map((g) => [g.label, formatHours(g.hours)]));
  }

  /** Statuses from settings plus any unknown status actually present in the files —
   *  otherwise a task with a hand-written status vanished from the chart yet still counted. */
  private allStatuses(found: string[]): string[] {
    const known = this.plugin.settings.statuses;
    const extra = Array.from(new Set(found)).filter((s) => s && !known.includes(s)).sort();
    return [...known, ...extra];
  }

  private renderStatusChart(parent: HTMLElement, data: AnalyticsData): void {
    const card = chartCard(parent, "Task status", `${data.tasks.length} tasks in this workspace`);
    const segments: StackSegment[] = this.allStatuses(data.tasks.map((t) => t.status)).map((status) => {
      const count = data.tasks.filter((t) => t.status === status).length;
      return {
        label: status,
        value: count,
        color: statusColor(status),
        tipLines: [status, `${count} task${count === 1 ? "" : "s"}`],
      };
    });

    stackedBar(card.body, segments, this.tooltip!);
    card.setTable(["Status", "Tasks"], segments.map((s) => [s.label, s.value]));
  }

  private renderPriorityChart(parent: HTMLElement, openTasks: TaskInfo[]): void {
    const card = chartCard(parent, "Priority mix", `${openTasks.length} open tasks`);
    const known = this.plugin.settings.priorities;
    const extra = Array.from(new Set(openTasks.map((t) => t.priority)))
      .filter((p) => p && !known.includes(p)).sort();
    const segments: StackSegment[] = [...known, ...extra].map((priority) => {
      const count = openTasks.filter((t) => t.priority === priority).length;
      return {
        label: priority,
        value: count,
        color: priorityColor(priority),
        tipLines: [priority, `${count} open task${count === 1 ? "" : "s"}`],
      };
    });

    stackedBar(card.body, segments, this.tooltip!);
    card.setTable(["Priority", "Open tasks"], segments.map((s) => [s.label, s.value]));
  }

  private renderAttentionCard(parent: HTMLElement, openTasks: TaskInfo[], today: string): void {
    const soon = addDays(today, 7);
    const dated = openTasks
      .filter((t) => t.due)
      .filter((t) => t.due <= soon)
      .sort((a, b) => (a.due < b.due ? -1 : 1));

    const card = chartCard(parent, "Needs attention", "Overdue and due within 7 days");
    if (!dated.length) {
      card.body.createDiv({ cls: "pm-db-empty", text: "Nothing due in the next 7 days." });
      return;
    }

    const list = card.body.createDiv({ cls: "pm-db-list" });
    for (const task of dated.slice(0, 10)) {
      const overdue = task.due < today;
      const days = daysBetween(today, task.due);
      this.renderListItem(list, {
        color: priorityColor(task.priority),
        title: task.title,
        meta: `${task.projectSlug || "no project"} · ${task.status} · ${task.priority}`,
        value: overdue ? `${Math.abs(days)}d late` : days === 0 ? "today" : `in ${days}d`,
        overdue,
        onClick: () => this.plugin.openTaskModal(task.file, this.currentWorkspace),
      });
    }

    card.setTable(
      ["Task", "Due", "Due (Jalali)", "Priority", "Status"],
      dated.map((t) => [t.title, t.due, this.plugin.calendar.label(t.due), t.priority, t.status])
    );
  }

  private renderRecentCard(parent: HTMLElement, data: AnalyticsData, inRange: TimeRecord[]): void {
    const card = chartCard(parent, "Recently tracked", "Latest time entries in this period");
    const recent = [...inRange].reverse().slice(0, 10);

    if (!recent.length) {
      card.body.createDiv({ cls: "pm-db-empty", text: "No entries in this period." });
      return;
    }

    const list = card.body.createDiv({ cls: "pm-db-list" });
    for (const rec of recent) {
      const task = data.tasksBySlug.get(rec.taskSlug);
      this.renderListItem(list, {
        color: task ? statusColor(task.status) : "var(--text-faint)",
        title: rec.taskTitle,
        meta: `${this.plugin.calendar.label(rec.iso)} · ${rec.projectSlug || "no project"}`,
        value: formatHours(rec.hours),
        onClick: () => {
          if (task) this.plugin.openTaskModal(task.file, this.currentWorkspace);
        },
      });
    }

    card.setTable(
      ["Date", "Date (Jalali)", "Task", "Hours"],
      [...inRange].reverse().map((r) => [r.iso, this.plugin.calendar.label(r.iso), r.taskTitle, formatHours(r.hours)])
    );
  }

  private renderListItem(
    list: HTMLElement,
    opts: { color: string; title: string; meta: string; value: string; overdue?: boolean; onClick?: () => void }
  ): void {
    const item = list.createDiv({ cls: "pm-db-item" });
    const dot = item.createDiv({ cls: "pm-db-item-dot" });
    dot.setCssStyles({ background: opts.color });
    const main = item.createDiv({ cls: "pm-db-item-main" });
    main.createDiv({ cls: "pm-db-item-title", text: opts.title });
    main.createDiv({ cls: "pm-db-item-meta", text: opts.meta });
    item.createDiv({ cls: `pm-db-item-val${opts.overdue ? " is-overdue" : ""}`, text: opts.value });

    if (opts.onClick) {
      item.setAttribute("tabindex", "0");
      item.addEventListener("click", opts.onClick);
      item.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onClick?.(); }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Calendar tab
  // ══════════════════════════════════════════════════════════════════════

  private renderCalendarTab(root: HTMLElement, data: AnalyticsData): void {
    const b = this.bounds(data);
    const days = rangeDays(b.from, b.to);
    const inRange = recordsInRange(data.records, b.from, b.to);
    const perDay = hoursPerDay(inRange, days);
    const today = todayISO();

    const total = sumHours(recordsInRange(data.records, b.from, b.effTo));
    const activeDays = days.filter((d) => (perDay.get(d) ?? 0) > 0).length;
    const busiest = days.reduce(
      (best, d) => ((perDay.get(d) ?? 0) > (perDay.get(best) ?? 0) ? d : best),
      days[0] ?? today
    );

    const headline = root.createDiv({ cls: "pm-db-headline" });
    heroFigure(headline, {
      label: `Tracked · ${b.label}`,
      value: formatNumber(total),
      unit: "hours",
      sub: `${activeDays} active day${activeDays === 1 ? "" : "s"} of ${days.length}`,
    });
    const tiles = headline.createDiv({ cls: "pm-db-tiles" });
    statTile(tiles, {
      label: "Busiest day",
      value: formatNumber(perDay.get(busiest) ?? 0),
      unit: "h",
      sub: (perDay.get(busiest) ?? 0) > 0 ? this.plugin.calendar.label(busiest) : "nothing logged yet",
    });
    statTile(tiles, {
      label: "Current streak",
      value: String(currentStreak(data.byDay)),
      unit: "days",
      sub: `longest ${longestStreak(data.byDay)} days`,
    });
    statTile(tiles, {
      label: "Days tracked",
      value: String(Array.from(data.byDay.values()).filter((rs) => rs.some((r) => r.hours > 0)).length),
      sub: "all time",
    });

    const card = chartCard(
      root,
      this.plugin.calendar.kind === "jalali" ? "Jalali calendar" : "Calendar",
      "Color shows how many hours were logged that day — click a day for the breakdown"
    );
    card.root.addClass("pm-db-wide");

    renderCalendar(card.body, {
      cal: this.plugin.calendar,
      days,
      hoursByDay: perDay,
      todayISO: today,
      selectedISO: this.selectedDay,
      mode: b.calMode,
      tooltip: this.tooltip!,
      tipFor: (iso) => this.dayTip(iso, data, perDay.get(iso) ?? 0),
      onSelect: (iso) => {
        this.selectedDay = this.selectedDay === iso ? null : iso;
        void this.render();
      },
    });
    heatLegend(card.body);

    card.setTable(
      ["Date", "Date (Jalali)", "Weekday", "Hours", "Tasks"],
      days.map((iso) => [
        iso,
        this.plugin.calendar.label(iso),
        this.plugin.calendar.weekdayLabel(iso),
        formatHours(perDay.get(iso) ?? 0),
        (data.byDay.get(iso) ?? []).map((r) => r.taskTitle).join(", ") || "—",
      ])
    );

    // If the selected day falls outside the period, say after stepping a month,
    // open the busiest day of this period rather than an unrelated one
    const inPeriod = this.selectedDay && this.selectedDay >= b.from && this.selectedDay <= b.to;
    const fallback = today >= b.from && today <= b.to ? today : busiest;
    this.renderDayPanel(root, data, inPeriod ? (this.selectedDay as string) : fallback);

    const cards = root.createDiv({ cls: "pm-db-cards pm-db-cards-spaced" });

    if (this.range !== "week" && this.range !== "month") {
      this.renderMonthlyTotals(cards, data, b);
    }
    this.renderTaskBreakdown(cards, data, inRange, b);
  }

  /** Per Jalali month totals — for the seasonal and yearly views, jumping to a month */
  private renderMonthlyTotals(parent: HTMLElement, data: AnalyticsData, b: RangeBounds): void {
    const cal = this.plugin.calendar;
    const groups = cal.groupByMonth(rangeDays(b.from, b.to));
    const card = chartCard(parent, "Hours per month", `${b.label} · click a month to open it`);

    const rows: BarRow[] = [];
    const tableRows: (string | number)[][] = [];
    for (const g of groups) {
      const isos = new Set(g.isos);
      const recs = data.records.filter((r) => isos.has(r.iso));
      const hours = sumHours(recs);
      const worked = recs.filter((r) => r.hours > 0);
      const dayCount = new Set(worked.map((r) => r.iso)).size;
      const taskCount = new Set(worked.map((r) => r.taskSlug)).size;
      const label = cal.monthLabel(g.y, g.m);

      rows.push({
        label,
        value: hours,
        valueText: formatHours(hours),
        tipLines: [label, `${formatHours(hours)} over ${dayCount} days`, `${taskCount} tasks`],
        onClick: () => {
          this.range = "month";
          this.anchor = cal.toISO(g.y, g.m, 1);
          this.selectedDay = null;
          this.scrollTop = 0;
          void this.render();
        },
      });
      tableRows.push([label, formatHours(hours), dayCount, taskCount]);
    }

    if (!rows.length) {
      card.body.createDiv({ cls: "pm-db-empty", text: "No months in this range." });
      return;
    }
    barListChart(card.body, rows, this.tooltip!);
    card.setTable(["Month", "Hours", "Active days", "Tasks"], tableRows);
  }

  /** Every task worked on in this period — name, project, hours, day count */
  private renderTaskBreakdown(
    parent: HTMLElement, data: AnalyticsData, inRange: TimeRecord[], b: RangeBounds
  ): void {
    const card = chartCard(parent, "Task breakdown", `Every task worked on in ${b.label}`);

    const map = new Map<string, { slug: string; title: string; project: string; hours: number; days: Set<string> }>();
    for (const rec of inRange) {
      if (rec.hours <= 0) continue;
      const row = map.get(rec.taskSlug) ?? {
        slug: rec.taskSlug, title: rec.taskTitle, project: rec.projectSlug, hours: 0, days: new Set<string>(),
      };
      row.hours = Math.round((row.hours + rec.hours) * 100) / 100;
      row.days.add(rec.iso);
      map.set(rec.taskSlug, row);
    }

    const rows = Array.from(map.values()).sort((a, b2) => b2.hours - a.hours);
    if (!rows.length) {
      card.body.createDiv({ cls: "pm-db-empty", text: "No task time in this period." });
      return;
    }

    const list = card.body.createDiv({ cls: "pm-db-list" });
    for (const row of rows.slice(0, 12)) {
      const task = data.tasksBySlug.get(row.slug);
      this.renderListItem(list, {
        color: task ? statusColor(task.status) : "var(--text-faint)",
        title: row.title,
        meta: `${row.project || "no project"}${task ? ` · ${task.status}` : ""} · ${row.days.size} day${row.days.size === 1 ? "" : "s"}`,
        value: formatHours(row.hours),
        onClick: () => { if (task) this.plugin.openTaskModal(task.file, this.currentWorkspace); },
      });
    }
    if (rows.length > 12) {
      card.body.createDiv({ cls: "pm-db-more", text: `+${rows.length - 12} more — open the table view` });
    }

    card.setTable(
      ["Task", "Project", "Status", "Days", "Hours"],
      rows.map((r) => {
        const task = data.tasksBySlug.get(r.slug);
        return [r.title, r.project || "—", task?.status ?? "—", r.days.size, formatHours(r.hours)];
      })
    );
  }

  private dayTip(iso: string, data: AnalyticsData, hours: number): string[] {
    const lines = [dayTitle(this.plugin.calendar, iso), `${formatHours(hours)} tracked`];
    const records = data.byDay.get(iso) ?? [];
    for (const rec of records.slice(0, 4)) {
      lines.push(`• ${rec.taskTitle} — ${formatHours(rec.hours)}`);
    }
    if (records.length > 4) lines.push(`+${records.length - 4} more`);
    lines.push(iso);
    return lines;
  }

  private renderDayPanel(root: HTMLElement, data: AnalyticsData, iso: string): void {
    const panel = root.createDiv({ cls: "pm-db-daypanel" });
    const records = data.byDay.get(iso) ?? [];
    const total = sumHours(records);

    const head = panel.createDiv({ cls: "pm-db-dayhead" });
    const left = head.createDiv();
    left.createDiv({ cls: "pm-db-daytitle", text: dayTitle(this.plugin.calendar, iso) });
    left.createDiv({ cls: "pm-db-daysub", text: iso });
    head.createDiv({ cls: "pm-db-daytotal", text: formatHours(total) });

    if (!records.length) {
      panel.createDiv({ cls: "pm-db-empty", text: "No time logged on this day." });
      return;
    }

    // A task's hours in one day are summed — several timers on one task is one row
    const byTask = new Map<string, { title: string; project: string; hours: number; slug: string }>();
    for (const rec of records) {
      const row = byTask.get(rec.taskSlug) ??
        { title: rec.taskTitle, project: rec.projectSlug, hours: 0, slug: rec.taskSlug };
      row.hours += rec.hours;
      byTask.set(rec.taskSlug, row);
    }

    const list = panel.createDiv({ cls: "pm-db-list" });
    for (const row of Array.from(byTask.values()).sort((a, b) => b.hours - a.hours)) {
      const task = data.tasksBySlug.get(row.slug);
      const share = total > 0 ? Math.round((row.hours / total) * 100) : 0;
      this.renderListItem(list, {
        color: task ? statusColor(task.status) : "var(--text-faint)",
        title: row.title,
        meta: `${row.project || "no project"}${task ? ` · ${task.status}` : ""} · ${share}% of the day`,
        value: formatHours(row.hours),
        onClick: () => { if (task) this.plugin.openTaskModal(task.file, this.currentWorkspace); },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Projects tab — the same status board as before
  // ══════════════════════════════════════════════════════════════════════

  private renderProjectsTab(root: HTMLElement, data: AnalyticsData): void {
    const board = root.createDiv({ cls: "pm-kanban-board" });

    for (const status of this.allStatuses(data.projects.map((p) => p.status))) {
      const col = board.createDiv({ cls: "pm-kanban-col" });
      col.setCssProps({ "--pm-status-color": statusColor(status) });
      col.createDiv({ cls: "pm-col-strip" });
      const header = col.createDiv({ cls: "pm-col-header" });
      header.createSpan({ cls: "pm-col-title", text: status });

      const colProjects = data.projects.filter((p) => {
        if (this.filterPriority && p.priority !== this.filterPriority) return false;
        if (this.filterStatus && p.status !== this.filterStatus) return false;
        return p.status === status;
      });

      header.createSpan({ cls: "pm-col-count", text: String(colProjects.length) });

      const cards = col.createDiv({ cls: "pm-col-cards" });
      cards.setAttribute("data-status", status);

      if (!colProjects.length) cards.createDiv({ cls: "pm-col-empty", text: "No projects here" });
      for (const project of colProjects) this.renderProjectCard(cards, project);

      cards.addEventListener("dragover", (e) => { e.preventDefault(); cards.addClass("pm-drag-over"); });
      cards.addEventListener("dragleave", () => cards.removeClass("pm-drag-over"));
      cards.addEventListener("drop", async (e) => {
        e.preventDefault();
        cards.removeClass("pm-drag-over");
        const projPath = e.dataTransfer?.getData("text/plain");
        if (!projPath) return;
        const file = this.app.vault.getAbstractFileByPath(projPath) as TFile | null;
        if (!file) return;
        await updateFrontmatterFields(this.app, file, { status });
        await this.plugin.syncArchiveFor(this.currentWorkspace, file);
        this.plugin.refreshProjectDashboard();
        this.plugin.refreshKanban();
      });
    }
  }

  private renderProjectCard(container: HTMLElement, project: ProjectInfo): void {
    const overdue = !!project.due && project.due < todayISO() && !isClosedStatus(project.status);

    const card = container.createDiv({ cls: "pm-task-card" });
    card.setAttribute("draggable", "true");
    card.setAttribute("data-path", project.file.path);
    if (overdue) card.addClass("pm-overdue-card");
    if (isMutedStatus(project.status)) card.addClass("pm-card-muted");

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", project.file.path);
      card.addClass("pm-dragging");
    });
    card.addEventListener("dragend", () => card.removeClass("pm-dragging"));

    // Title + priority dot — same head layout as a Kanban task card. Status is
    // already said by the column, so it does not repeat on the card itself.
    const head = card.createDiv({ cls: "pm-card-head" });
    head.createDiv({ cls: "pm-card-title", text: project.title });
    const notes = this.noted.get(project.file.path);
    if (notes) renderNoteBadge(head, notes);
    if (project.archived) {
      head.createSpan({
        cls: "pm-archived-badge",
        text: "🗄",
        attr: { "aria-label": "Archived — the file lives in the archive folder" },
      });
    }
    const prDot = head.createDiv({ cls: "pm-pr-dot" });
    prDot.setCssProps({ "--pm-priority-color": priorityColor(project.priority) });
    prDot.setAttribute("aria-label", `Priority: ${project.priority}`);

    // Meta row — due · tasks done · hours, all on one line
    const meta = card.createDiv({ cls: "pm-card-meta" });
    if (project.due) {
      meta.createSpan({ cls: overdue ? "pm-overdue" : "", text: `📅 ${this.plugin.calendar.label(project.due)}` });
      meta.createSpan({ cls: "pm-meta-dot" });
    }
    meta.createSpan({ text: `☑ ${project.doneCount}/${project.taskCount}` });
    meta.createSpan({ cls: "pm-card-hours", text: `⏱ ${formatHours(project.hours)}` });

    card.addEventListener("click", () => this.plugin.openProjectModal(project.file, this.currentWorkspace));

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Open project note").setIcon("file-text").onClick(() => {
          this.app.workspace.getLeaf(false).openFile(project.file);
        })
      );
      menu.addItem((item) =>
        item.setTitle("Edit project").setIcon("pencil").onClick(() => {
          this.plugin.openProjectModal(project.file, this.currentWorkspace);
        })
      );
      menu.showAtMouseEvent(e);
    });
  }
}
