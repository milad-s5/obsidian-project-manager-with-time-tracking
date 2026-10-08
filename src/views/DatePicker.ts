// A small popup calendar that speaks whichever calendar (Jalali or Gregorian)
// the plugin is set to, so a due date picked here reads the same as everywhere
// else in the dashboard. The value handed in and out is always a Gregorian
// ISO string (YYYY-MM-DD) — the calendar only changes how it is displayed.

import { App, Scope } from "obsidian";
import { Calendar } from "../utils/Calendar";
import { todayISO } from "../utils/Jalali";

export interface DatePickerOptions {
  app: App;
  cal: Calendar;
  value: string;
  placeholder?: string;
  onChange: (iso: string) => void;
}

export function mountDatePicker(container: HTMLElement, opts: DatePickerOptions): void {
  const cal = opts.cal;
  let value = opts.value;
  // Which month the popup is showing — starts on the value, or today if empty
  let view = cal.fromISO(value || todayISO());

  container.empty();
  container.addClass("pm-dp");

  const trigger = container.createDiv({ cls: "pm-dp-trigger", attr: { tabindex: "0" } });
  const label = trigger.createSpan({ cls: "pm-dp-trigger-label" });
  trigger.createSpan({ cls: "pm-dp-trigger-icon", text: "📅" });
  const clearBtn = trigger.createSpan({ cls: "pm-dp-clear", text: "✕", attr: { "aria-label": "Clear date" } });

  // The panel is laid over the page while open, not inside the field: a field
  // low in a dialog would otherwise have its calendar cut off by the dialog's
  // scroll area, and the month had to be scrolled into view
  const doc = container.ownerDocument;
  const panel = doc.body.createDiv({ cls: "pm-dp-panel pm-hidden" });
  panel.detach();
  panel.setAttribute("dir", cal.kind === "jalali" ? "rtl" : "ltr");
  // The host modal treats Enter as "submit" wherever it lands. Inside the panel
  // Enter should only activate whichever button is focused (day cell, nav, foot).
  panel.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });

  const syncLabel = (): void => {
    label.setText(value ? cal.label(value) : opts.placeholder ?? "Select date…");
    label.toggleClass("is-empty", !value);
    clearBtn.toggleClass("pm-hidden", !value);
  };
  syncLabel();

  const win = doc.defaultView ?? window;
  const closePanel = (): void => {
    panel.addClass("pm-hidden");
    panel.detach();
    doc.removeEventListener("mousedown", onOutsideClick, true);
    opts.app.keymap.popScope(keys);
    win.removeEventListener("resize", closePanel);
    doc.removeEventListener("scroll", onScroll, true);
    gone.disconnect();
  };
  // The dialog holding the field closed while the panel was open
  const gone = new MutationObserver(() => { if (!container.isConnected) closePanel(); });
  const onOutsideClick = (e: MouseEvent): void => {
    const target = e.target as Node;
    if (!container.contains(target) && !panel.contains(target)) closePanel();
  };
  // While open, Escape closes the calendar rather than the dialog around it
  const keys = new Scope(opts.app.scope);
  keys.register([], "Escape", () => { closePanel(); return false; });
  // Scrolling whatever holds the field would leave the panel behind
  const onScroll = (e: Event): void => {
    if (!panel.contains(e.target as Node)) closePanel();
  };

  /** Below the field, or above it when there is more room there, always on screen */
  const place = (): void => {
    const margin = 8;
    const gap = 6;
    const r = trigger.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    const below = vh - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    let top = h <= below || below >= above ? r.bottom + gap : r.top - gap - h;
    top = Math.max(margin, Math.min(top, vh - h - margin));
    // Settings put their controls on the right, so the panel lines up with the field's right edge
    let left = r.right - w;
    left = Math.max(margin, Math.min(left, vw - w - margin));
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
  };

  const openPanel = (): void => {
    view = cal.fromISO(value || todayISO());
    renderPanel();
    doc.body.appendChild(panel);
    panel.removeClass("pm-hidden");
    place();
    doc.addEventListener("mousedown", onOutsideClick, true);
    opts.app.keymap.pushScope(keys);
    win.addEventListener("resize", closePanel);
    doc.addEventListener("scroll", onScroll, true);
    gone.observe(doc.body, { childList: true });
  };

  const pick = (iso: string): void => {
    value = iso;
    syncLabel();
    closePanel();
    opts.onChange(value);
  };

  function renderPanel(): void {
    panel.empty();
    const today = todayISO();

    const head = panel.createDiv({ cls: "pm-dp-head" });
    const prev = head.createEl("button", { cls: "pm-dp-navbtn", text: "‹", attr: { type: "button" } });
    prev.addEventListener("click", (e) => {
      e.stopPropagation();
      const total = view.y * 12 + (view.m - 1) - 1;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      view = { y: ny, m: nm, d: 1 };
      renderPanel();
    });
    head.createDiv({ cls: "pm-dp-headlabel", text: cal.monthLabel(view.y, view.m) });
    const next = head.createEl("button", { cls: "pm-dp-navbtn", text: "›", attr: { type: "button" } });
    next.addEventListener("click", (e) => {
      e.stopPropagation();
      const total = view.y * 12 + (view.m - 1) + 1;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      view = { y: ny, m: nm, d: 1 };
      renderPanel();
    });

    const weekdays = panel.createDiv({ cls: "pm-dp-weekdays" });
    cal.weekdaysShort.forEach((w) => weekdays.createDiv({ cls: "pm-dp-weekday", text: w }));

    const grid = panel.createDiv({ cls: "pm-dp-grid" });
    const startCol = cal.firstWeekdayCol(view.y, view.m);
    for (let i = 0; i < startCol; i++) grid.createDiv({ cls: "pm-dp-cell is-empty" });

    const len = cal.monthLength(view.y, view.m);
    for (let d = 1; d <= len; d++) {
      const iso = cal.toISO(view.y, view.m, d);
      const cell = grid.createEl("button", {
        cls: "pm-dp-cell",
        text: cal.digits(d),
        attr: { type: "button" },
      });
      if (iso === today) cell.addClass("is-today");
      if (iso === value) cell.addClass("is-selected");
      cell.addEventListener("click", (e) => { e.stopPropagation(); pick(iso); });
    }

    const foot = panel.createDiv({ cls: "pm-dp-foot" });
    const todayBtn = foot.createEl("button", { cls: "pm-dp-footbtn", text: "Today", attr: { type: "button" } });
    todayBtn.addEventListener("click", (e) => { e.stopPropagation(); pick(today); });
    const clear = foot.createEl("button", { cls: "pm-dp-footbtn", text: "Clear", attr: { type: "button" } });
    clear.addEventListener("click", (e) => { e.stopPropagation(); pick(""); });
    // A month with an extra week is taller
    if (panel.isConnected) place();
  }

  trigger.addEventListener("click", () => {
    if (!panel.isConnected || panel.hasClass("pm-hidden")) openPanel();
    else closePanel();
  });
  trigger.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      trigger.click();
    }
  });
  clearBtn.addEventListener("click", (e) => { e.stopPropagation(); pick(""); });
}
