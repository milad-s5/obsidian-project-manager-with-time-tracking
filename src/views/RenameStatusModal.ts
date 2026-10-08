import { App, Modal, Notice, Setting } from "obsidian";
import type ProjectManagerPlugin from "../main";
import { FIXED_STATUSES, renameStatusInNotes, renameStatusInSettings } from "../managers/StatusRenamer";

/** Picks a status and its new name, then renames it in settings and every note */
export class RenameStatusModal extends Modal {
  private from = "";
  private to = "";

  constructor(app: App, private plugin: ProjectManagerPlugin, private onDone: () => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal");
    contentEl.createEl("h2", { text: "Rename a status" });
    contentEl.createEl("p", {
      cls: "pm-confirm-body",
      text:
        "Every task and project with this status is updated, archived ones included. " +
        "Renaming to a status that already exists merges the two. " +
        "Backlog, active and done cannot be renamed, since features depend on those names.",
    });

    const renamable = this.plugin.settings.statuses.filter((s) => !FIXED_STATUSES.includes(s));
    this.from = renamable[0] ?? "";
    new Setting(contentEl).setName("Status").addDropdown((d) => {
      renamable.forEach((s) => d.addOption(s, s));
      d.setValue(this.from).onChange((v) => (this.from = v));
    });
    new Setting(contentEl).setName("New name").addText((t) => {
      t.onChange((v) => (this.to = v));
      t.inputEl.focus();
    });

    const btns = contentEl.createDiv({ cls: "pm-modal-btns" });
    btns.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Cancel" })
      .addEventListener("click", () => this.close());
    const go = btns.createEl("button", { cls: "pm-btn pm-btn-primary", text: "Rename" });
    go.addEventListener("click", async () => {
      const to = this.to.trim().toLowerCase();
      if (!this.from || !to) { new Notice("Pick a status and type its new name"); return; }
      if (to === this.from) { this.close(); return; }
      go.disabled = true;
      const changed = await renameStatusInNotes(this.app, this.plugin.settings.workspaces, this.from, to);
      renameStatusInSettings(this.plugin.settings, this.from, to);
      await this.plugin.saveSettings();
      this.plugin.refreshTimerViews();
      new Notice(`"${this.from}" renamed to "${to}" — ${changed} note${changed === 1 ? "" : "s"} updated`);
      this.close();
      this.onDone();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
