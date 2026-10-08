// ╔══════════════════════════════════════════════════════════════════════╗
// ║  DashboardCharts — the dashboard's visual pieces                     ║
// ║  Every chart here keeps three rules: colour only from the validated  ║
// ║  pm-cat/pm-heat tokens, a table view for when colour is not enough,  ║
// ║  and a tooltip is never the only way to read a number.               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Calendar } from "../utils/Calendar";

// ── Number formatting ───────────────────────────────────────────────────

export function formatHours(h: number): string {
  const totalMin = Math.round((h || 0) * 60);
  if (totalMin <= 0) return "0h";
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh && mm) return `${hh}h ${mm}m`;
  if (hh) return `${hh}h`;
  return `${mm}m`;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// ── Shared tooltip ──────────────────────────────────────────────────────
// The tooltip only ever supplements; the same numbers sit in each card's table view.

export class ChartTooltip {
  private el: HTMLElement;

  constructor(private host: HTMLElement) {
    this.el = host.createDiv({ cls: "pm-db-tip" });
    this.el.addClass("pm-hidden");
  }

  /** Attaches the tooltip to a mark — for the mouse and for keyboard focus alike */
  attach(mark: HTMLElement, lines: () => string[]): void {
    const show = () => this.show(mark, lines());
    mark.addEventListener("mouseenter", show);
    mark.addEventListener("focus", show);
    mark.addEventListener("mousemove", show);
    mark.addEventListener("mouseleave", () => this.hide());
    mark.addEventListener("blur", () => this.hide());
    mark.setAttribute("tabindex", "0");
    mark.setAttribute("role", "img");
    // Not aria-label: Obsidian renders its own tooltip for anything carrying
    // one, which then sits underneath ours saying the same thing twice. A
    // visually hidden label gives assistive tech the text without the double.
    mark.createSpan({ cls: "pm-db-sr-only", text: lines().join(" — ") });
  }

  private show(mark: HTMLElement, lines: string[]): void {
    this.el.empty();
    lines.forEach((line, i) => {
      this.el.createDiv({ cls: i === 0 ? "pm-db-tip-head" : "pm-db-tip-row", text: line });
    });
    this.el.removeClass("pm-hidden");

    const hostBox = this.host.getBoundingClientRect();
    const markBox = mark.getBoundingClientRect();
    const tipBox = this.el.getBoundingClientRect();

    let left = markBox.left - hostBox.left + markBox.width / 2 - tipBox.width / 2;
    left = Math.max(6, Math.min(left, hostBox.width - tipBox.width - 6));
    let top = markBox.top - hostBox.top - tipBox.height - 8;
    if (top < 4) top = markBox.bottom - hostBox.top + 8;

    this.el.setCssStyles({ left: `${left}px`, top: `${top}px` });
  }

  hide(): void { this.el.addClass("pm-hidden"); }
}

// ── Chart card and the table-view toggle ────────────────────────────────

export interface ChartCard {
  root: HTMLElement;
  body: HTMLElement;
  /** The table equivalent of this chart — the Table toggle swaps it in */
  setTable(columns: string[], rows: (string | number)[][]): void;
}

export function chartCard(parent: HTMLElement, title: string, subtitle?: string): ChartCard {
  const root = parent.createDiv({ cls: "pm-db-card" });
  const head = root.createDiv({ cls: "pm-db-cardhead" });
  const titles = head.createDiv({ cls: "pm-db-titles" });
  titles.createDiv({ cls: "pm-db-cardtitle", text: title });
  if (subtitle) titles.createDiv({ cls: "pm-db-cardsub", text: subtitle });

  const body = root.createDiv({ cls: "pm-db-cardbody" });
  const tableWrap = root.createDiv({ cls: "pm-db-tablewrap" });
  tableWrap.addClass("pm-hidden");

  const toggle = head.createEl("button", { cls: "pm-db-toggle", text: "Table" });
  toggle.setAttribute("aria-pressed", "false");
  toggle.addClass("pm-hidden");
  toggle.addEventListener("click", () => {
    const showTable = tableWrap.hasClass("pm-hidden");
    tableWrap.toggleClass("pm-hidden", !showTable);
    body.toggleClass("pm-hidden", showTable);
    toggle.textContent = showTable ? "Chart" : "Table";
    toggle.setAttribute("aria-pressed", String(showTable));
  });

  return {
    root,
    body,
    setTable(columns, rows) {
      tableWrap.empty();
      const table = tableWrap.createEl("table", { cls: "pm-db-table" });
      const thead = table.createEl("thead").createEl("tr");
      columns.forEach((c) => thead.createEl("th", { text: c }));
      const tbody = table.createEl("tbody");
      rows.forEach((r) => {
        const tr = tbody.createEl("tr");
        r.forEach((cell) => tr.createEl("td", { text: String(cell) }));
      });
      toggle.removeClass("pm-hidden");
    },
  };
}

// ── Hero figure and stat tiles ──────────────────────────────────────────

export interface StatTileOptions {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  /** Up or down against the previous period — decides the colour direction */
  delta?: { text: string; direction: "up" | "down" | "flat" };
  tone?: "default" | "warn" | "critical";
}

export function heroFigure(parent: HTMLElement, opts: StatTileOptions): HTMLElement {
  const el = parent.createDiv({ cls: "pm-db-hero" });
  el.createDiv({ cls: "pm-db-hero-label", text: opts.label });
  const row = el.createDiv({ cls: "pm-db-hero-row" });
  row.createSpan({ cls: "pm-db-hero-value", text: opts.value });
  if (opts.unit) row.createSpan({ cls: "pm-db-hero-unit", text: opts.unit });
  if (opts.delta) {
    const arrow = opts.delta.direction === "up" ? "↑" : opts.delta.direction === "down" ? "↓" : "→";
    row.createSpan({ cls: `pm-db-delta pm-db-delta-${opts.delta.direction}`, text: `${arrow} ${opts.delta.text}` });
  }
  if (opts.sub) el.createDiv({ cls: "pm-db-hero-sub", text: opts.sub });
  return el;
}

export function statTile(parent: HTMLElement, opts: StatTileOptions): HTMLElement {
  const el = parent.createDiv({ cls: `pm-db-tile pm-db-tone-${opts.tone ?? "default"}` });
  el.createDiv({ cls: "pm-db-tile-label", text: opts.label });
  const row = el.createDiv({ cls: "pm-db-tile-row" });
  row.createSpan({ cls: "pm-db-tile-value", text: opts.value });
  if (opts.unit) row.createSpan({ cls: "pm-db-tile-unit", text: opts.unit });
  if (opts.sub) el.createDiv({ cls: "pm-db-tile-sub", text: opts.sub });
  return el;
}

// ── Column chart: one series, so no legend (the card title says it) ─────

export interface ColumnPoint {
  key: string;
  axisLabel: string;
  tipLines: string[];
  value: number;
}

export function columnChart(
  parent: HTMLElement,
  points: ColumnPoint[],
  tooltip: ChartTooltip,
  onSelect?: (p: ColumnPoint) => void
): void {
  const max = Math.max(1, ...points.map((p) => p.value));
  const top = niceCeil(max);

  const plot = parent.createDiv({ cls: "pm-db-plot" });
  const yAxis = plot.createDiv({ cls: "pm-db-yaxis" });
  [top, top / 2, 0].forEach((v) => yAxis.createDiv({ cls: "pm-db-ytick", text: formatNumber(v) }));

  const area = plot.createDiv({ cls: "pm-db-plotarea" });
  const grid = area.createDiv({ cls: "pm-db-grid" });
  [0, 50, 100].forEach((pct) => {
    const line = grid.createDiv({ cls: "pm-db-gridline" });
    line.setCssStyles({ bottom: `${pct}%` });
  });

  const cols = area.createDiv({ cls: "pm-db-cols" });
  // x-axis label spacing is chosen so labels cannot collide
  const step = Math.max(1, Math.ceil(points.length / 12));

  points.forEach((p, i) => {
    const col = cols.createDiv({ cls: "pm-db-col" });
    const bar = col.createDiv({ cls: "pm-db-bar" });
    if (p.value <= 0) {
      // A day with nothing logged still leaves a thin trace, so an empty column is
      // not mistaken for a gap in the data. Its height comes from the class.
      bar.addClass("pm-db-bar-zero");
    } else {
      bar.setCssStyles({ height: `${Math.max(2, (p.value / top) * 100)}%` });
    }
    tooltip.attach(col, () => p.tipLines);
    if (onSelect) {
      col.addClass("pm-db-clickable");
      col.addEventListener("click", () => onSelect(p));
      col.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p); }
      });
    }
    const lbl = col.createDiv({ cls: "pm-db-xlabel" });
    if (i % step === 0 || i === points.length - 1) lbl.textContent = p.axisLabel;
  });
}

/** Rounds the axis ceiling up to the next tidy number — the steps are small so a
 *  six-hour day does not stretch the axis to 10 and waste half the height */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const stepped = NICE_STEPS.find((s) => n <= s + 1e-9) ?? 10;
  return stepped * mag;
}

// ── Horizontal bars: one series, slot 1 colour, value at the bar's end ──

export interface BarRow {
  label: string;
  value: number;
  valueText: string;
  tipLines: string[];
  onClick?: () => void;
}

export function barListChart(parent: HTMLElement, rows: BarRow[], tooltip: ChartTooltip): void {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const wrap = parent.createDiv({ cls: "pm-db-bars" });

  for (const row of rows) {
    const line = wrap.createDiv({ cls: "pm-db-brow" });
    line.createDiv({ cls: "pm-db-blabel", text: row.label });
    const track = line.createDiv({ cls: "pm-db-btrack" });
    const fill = track.createDiv({ cls: "pm-db-bfill" });
    fill.setCssStyles({ width: `${Math.max(1.5, (row.value / max) * 100)}%` });
    line.createDiv({ cls: "pm-db-bval", text: row.valueText });

    tooltip.attach(line, () => row.tipLines);
    if (row.onClick) {
      line.addClass("pm-db-clickable");
      line.addEventListener("click", row.onClick);
      line.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onClick?.(); }
      });
    }
  }
}

// ── Stacked bar and legend (always a legend, since there is >1 series) ──

export interface StackSegment {
  label: string;
  value: number;
  color: string;
  tipLines: string[];
}

export function stackedBar(parent: HTMLElement, segments: StackSegment[], tooltip: ChartTooltip): void {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const wrap = parent.createDiv({ cls: "pm-db-stackwrap" });
  const bar = wrap.createDiv({ cls: "pm-db-stack" });

  if (total === 0) {
    bar.createDiv({ cls: "pm-db-stack-empty" });
  } else {
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const el = bar.createDiv({ cls: "pm-db-seg" });
      el.setCssStyles({ flexGrow: String(seg.value), background: seg.color });
      tooltip.attach(el, () => seg.tipLines);
    }
  }

  // No labels inside segments — small ones would clip — the legend carries identity
  const legend = wrap.createDiv({ cls: "pm-db-legend" });
  for (const seg of segments) {
    const item = legend.createDiv({ cls: "pm-db-legitem" });
    const dot = item.createSpan({ cls: "pm-db-legdot" });
    dot.setCssStyles({ background: seg.color });
    item.createSpan({ cls: "pm-db-legname", text: seg.label });
    item.createSpan({ cls: "pm-db-legval", text: String(seg.value) });
  }
}

// ── Calendar ────────────────────────────────────────────────────────────
// Three modes, exactly like the vault's HabitCalendar: weekly (dots), monthly and
// seasonal (grid), yearly (heatmap). Colour is intensity, from the pm-heat ramp.

export type CalendarMode = "dots" | "grid" | "heatmap";

/** Fixed thresholds in hours — deliberately not tied to the range max, so a day's
 *  colour does not shift when a filter changes. */
const HEAT_STOPS = [1, 2.5, 4, 6];

export function heatBin(hours: number): number {
  if (hours <= 0) return 0;
  for (let i = 0; i < HEAT_STOPS.length; i++) if (hours <= HEAT_STOPS[i]) return i + 1;
  return HEAT_STOPS.length + 1;
}

export interface CalendarOptions {
  /** Which calendar to draw in — the whole widget follows it */
  cal: Calendar;
  days: string[];
  hoursByDay: Map<string, number>;
  todayISO: string;
  selectedISO: string | null;
  mode: CalendarMode;
  tooltip: ChartTooltip;
  tipFor: (iso: string) => string[];
  onSelect: (iso: string) => void;
}

export function renderCalendar(parent: HTMLElement, opts: CalendarOptions): void {
  const wrap = parent.createDiv({ cls: `pm-db-cal pm-db-cal-${opts.mode}` });

  // The grid inherited the vault's text direction, so in a right-to-left vault
  // a Gregorian calendar came out mirrored: Fri Thu Wed reading left to right,
  // and the first of the month in the top-right corner. Direction belongs to
  // the calendar being drawn, not to the vault it is drawn in.
  wrap.setAttribute("dir", opts.cal.kind === "jalali" ? "rtl" : "ltr");

  if (opts.mode === "dots") renderCalDots(wrap, opts);
  else if (opts.mode === "heatmap") renderCalHeatmap(wrap, opts);
  else renderCalGrid(wrap, opts);
}

function applyCell(cell: HTMLElement, iso: string, opts: CalendarOptions): void {
  const hours = opts.hoursByDay.get(iso) ?? 0;
  cell.setAttribute("data-heat", String(heatBin(hours)));
  if (iso === opts.todayISO) cell.addClass("is-today");
  if (iso === opts.selectedISO) cell.addClass("is-selected");
  opts.tooltip.attach(cell, () => opts.tipFor(iso));
  cell.addEventListener("click", () => opts.onSelect(iso));
  cell.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onSelect(iso); }
  });
}

function renderCalDots(wrap: HTMLElement, opts: CalendarOptions): void {
  const row = wrap.createDiv({ cls: "pm-db-caldays" });
  for (const iso of opts.days) {
    const day = row.createDiv({ cls: "pm-db-calday" });
    day.createDiv({ cls: "pm-db-caldn", text: opts.cal.weekdaysShort[opts.cal.weekdayCol(iso)] });
    const dot = day.createDiv({ cls: "pm-db-caldot" });
    const hours = opts.hoursByDay.get(iso) ?? 0;
    dot.textContent = hours > 0 ? formatHours(hours).replace(/\s.*/, "") : "–";
    applyCell(dot, iso, opts);
    day.createDiv({ cls: "pm-db-caldd", text: opts.cal.digits(opts.cal.fromISO(iso).d) });
  }
}

function renderCalGrid(wrap: HTMLElement, opts: CalendarOptions): void {
  for (const group of opts.cal.groupByMonth(opts.days)) {
    const section = wrap.createDiv({ cls: "pm-db-calmonth" });
    section.createDiv({ cls: "pm-db-calmtitle", text: opts.cal.monthLabel(group.y, group.m) });

    const hdr = section.createDiv({ cls: "pm-db-calhdr" });
    opts.cal.weekdaysShort.forEach((d) => hdr.createDiv({ cls: "pm-db-calwday", text: d }));

    const grid = section.createDiv({ cls: "pm-db-calgrid" });
    const startCol = opts.cal.firstWeekdayCol(group.y, group.m);
    // If the range starts mid-month, only run up to the first day present
    const firstDay = opts.cal.fromISO(group.isos[0]).d;
    const lead = (startCol + firstDay - 1) % 7;
    for (let i = 0; i < lead; i++) grid.createDiv({ cls: "pm-db-calcell is-empty" });

    for (const iso of group.isos) {
      const cell = grid.createDiv({ cls: "pm-db-calcell" });
      cell.textContent = opts.cal.digits(opts.cal.fromISO(iso).d);
      applyCell(cell, iso, opts);
    }
  }
}

function renderCalHeatmap(wrap: HTMLElement, opts: CalendarOptions): void {
  for (const group of opts.cal.groupByMonth(opts.days)) {
    const row = wrap.createDiv({ cls: "pm-db-hmrow" });
    row.createDiv({ cls: "pm-db-hmlbl", text: opts.cal.monthsShort[group.m - 1] });
    const cells = row.createDiv({ cls: "pm-db-hmcells" });

    const startCol = opts.cal.firstWeekdayCol(group.y, group.m);
    const firstDay = opts.cal.fromISO(group.isos[0]).d;
    const lead = (startCol + firstDay - 1) % 7;
    for (let i = 0; i < lead; i++) cells.createDiv({ cls: "pm-db-hmcell is-empty" });

    for (const iso of group.isos) {
      const cell = cells.createDiv({ cls: "pm-db-hmcell" });
      applyCell(cell, iso, opts);
    }
  }
}

/** The ramp's scale legend — mandatory for a continuous encoding */
export function heatLegend(parent: HTMLElement): void {
  const legend = parent.createDiv({ cls: "pm-db-heatlegend" });
  legend.createSpan({ cls: "pm-db-heatlabel", text: "Less" });
  const scale = legend.createDiv({ cls: "pm-db-heatscale" });
  const titles = ["No time logged", "up to 1h", "1–2.5h", "2.5–4h", "4–6h", "over 6h"];
  for (let bin = 0; bin <= 5; bin++) {
    const swatch = scale.createDiv({ cls: "pm-db-heatswatch" });
    swatch.setAttribute("data-heat", String(bin));
    swatch.setAttribute("title", titles[bin]);
    swatch.setAttribute("aria-label", titles[bin]);
  }
  legend.createSpan({ cls: "pm-db-heatlabel", text: "More" });
}

export function dayTitle(cal: Calendar, iso: string): string {
  return cal.dayTitle(iso);
}
