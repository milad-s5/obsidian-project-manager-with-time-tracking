import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { LoggedTime, TimeEntryEditor } from "../managers/TimeEntryEditor";
import { mountDatePicker } from "./DatePicker";
import { ConfirmModal } from "./ConfirmModal";
import { formatHours } from "./DashboardCharts";
import { isoToDate, toISODate } from "../utils/Jalali";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date | null) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "");

/**
 * The task dialog's list of logged time: every session, with its day,
 * hours and times, each one editable and deletable. A change is made to
 * the time entry note, the Time Log row and the task's totals together,
 * and the project's hours follow.
 */
export function renderTimeEntries(
  parent: HTMLElement,
  plugin: ProjectManagerPlugin,
  ws: Workspace,
  task: TFile
): void {
  const editor = new TimeEntryEditor(plugin.app);
  const root = parent.createDiv({ cls: "pm-entries" });
  // Stays open across redraws, so an edit or delete does not fold the list away
  let open = false;

  const draw = async (): Promise<void> => {
    const items = await editor.list(ws, task);
    root.empty();
    const total = Math.round(items.reduce((s, i) => s + i.hours, 0) * 100) / 100;
    const days = new Set(items.filter((i) => i.hours > 0).map((i) => i.iso)).size;

    const head = root.createDiv({ cls: "pm-entries-head" });
    head.createSpan({ cls: "pm-entries-total", text: `${formatHours(total)} over ${days} day${days === 1 ? "" : "s"}` });
    const label = () => (open ? "Hide logged time" : `Edit logged time (${items.length})`);
    const toggle = head.createEl("button", { cls: "pm-btn pm-btn-secondary", text: label() });

    const list = root.createDiv({ cls: "pm-entries-list" });
    list.toggleClass("pm-hidden", !open);
    toggle.addEventListener("click", () => {
      open = !open;
      list.toggleClass("pm-hidden", !open);
      toggle.setText(label());
    });
    if (!items.length) {
      list.createDiv({ cls: "pm-db-empty", text: "No time logged yet." });
      return;
    }

    for (const item of items) {
      const row = list.createDiv({ cls: "pm-entry" });
      const main = row.createDiv({ cls: "pm-entry-main" });
      main.createDiv({ cls: "pm-entry-day", text: plugin.calendar.label(item.iso) });
      const span = item.start && item.end ? `${clock(item.start)}–${clock(item.end)}` : "no start time";
      main.createDiv({ cls: "pm-entry-meta", text: item.entryFile ? span : `${span} · Time Log only` });
      row.createDiv({ cls: "pm-entry-hours", text: formatHours(item.hours) });

      const edit = row.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Edit" });
      edit.addEventListener("click", () => {
        new EditTimeModal(plugin.app, plugin, item, async (start, hours) => {
          await editor.update(ws, task, item, start, hours);
          new Notice("Time entry updated");
          plugin.refreshTimerViews();
          await draw();
        }).open();
      });

      const del = row.createEl("button", { cls: "pm-btn pm-btn-danger", text: "Delete" });
      del.addEventListener("click", () => {
        new ConfirmModal(plugin.app, {
          title: "Delete this time?",
          body:
            `${formatHours(item.hours)} on ${plugin.calendar.label(item.iso)} is removed: ` +
            "its time entry note and its Time Log row, and the task's and project's totals are recounted.",
          confirmText: "Delete",
          onConfirm: async () => {
            await editor.remove(ws, task, item, plugin.settings.deleteBehaviour);
            new Notice("Time entry deleted");
            plugin.refreshTimerViews();
            await draw();
          },
        }).open();
      });
    }
  };

  void draw();
}

/** Day, start time and length of one session */
class EditTimeModal extends Modal {
  private day: string;
  private start: string;
  private hours: string;

  constructor(
    app: App,
    private plugin: ProjectManagerPlugin,
    item: LoggedTime,
    private onSave: (start: Date, hours: number) => Promise<void>
  ) {
    super(app);
    this.day = item.iso;
    this.start = clock(item.start) || "09:00";
    this.hours = String(item.hours);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal");
    contentEl.createEl("h2", { text: "Edit logged time" });

    const daySetting = new Setting(contentEl).setName("Day");
    mountDatePicker(daySetting.controlEl, {
      cal: this.plugin.calendar,
      value: this.day,
      onChange: (v) => (this.day = v || this.day),
    });
    new Setting(contentEl).setName("Started at").addText((t) => {
      t.inputEl.type = "time";
      t.setValue(this.start).onChange((v) => (this.start = v));
    });
    new Setting(contentEl).setName("Hours").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.step = "0.25";
      t.inputEl.min = "0";
      t.setValue(this.hours).onChange((v) => (this.hours = v));
    });

    const btns = contentEl.createDiv({ cls: "pm-modal-btns" });
    btns.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Cancel" })
      .addEventListener("click", () => this.close());
    const save = btns.createEl("button", { cls: "pm-btn pm-btn-primary", text: "Save" });
    save.addEventListener("click", async () => {
      const h = parseFloat(this.hours);
      if (!Number.isFinite(h) || h <= 0) { new Notice("Enter a number of hours above zero"); return; }
      const [hh, mm] = this.start.split(":").map(Number);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) { new Notice("Enter a start time"); return; }
      const start = isoToDate(this.day || toISODate(new Date()));
      start.setHours(hh, mm, 0, 0);
      save.disabled = true;
      try {
        await this.onSave(start, h);
        this.close();
      } catch (err) {
        new Notice(err instanceof Error ? err.message : String(err));
        save.disabled = false;
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
