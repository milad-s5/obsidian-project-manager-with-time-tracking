// A small popup calendar that speaks whichever calendar (Jalali or Gregorian)
// the plugin is set to, so a due date picked here reads the same as everywhere
// else in the dashboard. The value handed in and out is always a Gregorian
// ISO string (YYYY-MM-DD) — the calendar only changes how it is displayed.

import { Calendar } from "../utils/Calendar";
import { todayISO } from "../utils/Jalali";

export interface DatePickerOptions {
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
  const icon = trigger.createSpan({ cls: "pm-dp-trigger-icon", text: "📅" });
  const clearBtn = trigger.createSpan({ cls: "pm-dp-clear", text: "✕", attr: { "aria-label": "Clear date" } });

  const panel = container.createDiv({ cls: "pm-dp-panel is-hidden" });
  panel.setAttribute("dir", cal.kind === "jalali" ? "rtl" : "ltr");
  // The host modal treats Enter as "submit" wherever it lands. Inside the panel
  // Enter should only activate whichever button is focused (day cell, nav, foot).
  panel.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });

  const syncLabel = (): void => {
    label.setText(value ? cal.label(value) : opts.placeholder ?? "Select date…");
    label.toggleClass("is-empty", !value);
    clearBtn.toggleClass("is-hidden", !value);
  };
  syncLabel();

  const closePanel = (): void => {
    panel.addClass("is-hidden");
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("keydown", onKeydown, true);
  };
  const onOutsideClick = (e: MouseEvent): void => {
    if (!container.contains(e.target as Node)) closePanel();
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { e.preventDefault(); closePanel(); }
  };
  const openPanel = (): void => {
    view = cal.fromISO(value || todayISO());
    renderPanel();
    panel.removeClass("is-hidden");
    document.addEventListener("mousedown", onOutsideClick, true);
    document.addEventListener("keydown", onKeydown, true);
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
  }

  trigger.addEventListener("click", () => {
    if (panel.hasClass("is-hidden")) openPanel();
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
