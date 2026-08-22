import { App, Modal, TFile, Notice, Setting } from "obsidian";
import ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { linkSlug, renameHeading, updateFrontmatterFields } from "../utils/FrontmatterUtils";
import { isMutedStatus, normalizeStatus, statusColor } from "../utils/StatusColors";
import { mountDatePicker } from "./DatePicker";
import { formatHours } from "./DashboardCharts";
import { ConfirmModal } from "./ConfirmModal";
import { deleteNote, deleteWarning } from "../utils/FileOps";
import { isUnderAnyFolder, taskFolders } from "../utils/WorkspacePaths";

export class ProjectModal extends Modal {
  plugin: ProjectManagerPlugin;
  file: TFile | null;
  ws: Workspace;
  isNew: boolean;

  title = "";
  /** The title as it was when the modal opened, so the H1 can be found */
  private originalTitle = "";
  status = "todo";
  priority = "medium";
  due = "";

  constructor(
    app: App,
    plugin: ProjectManagerPlugin,
    ws: Workspace,
    file: TFile | null = null
  ) {
    super(app);
    this.plugin = plugin;
    this.ws = ws;
    this.file = file;
    this.isNew = file === null;

    if (file) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      this.title = fm.title ?? file.basename;
      this.originalTitle = this.title;
      this.status = normalizeStatus(fm.status ?? "todo");
      this.priority = fm.priority ?? "medium";
      this.due = fm.due ?? "";
    }
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal");

    // Enter in any field does what clicking Create/Save does
    contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing) return;
      if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
      e.preventDefault();
      void this.submitAndClose();
    });

    contentEl.createEl("h2", { text: this.isNew ? "New Project" : `Project: ${this.title}` });

    new Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(this.title).onChange((v) => (this.title = v));
      if (this.isNew) t.inputEl.focus();
    });

    new Setting(contentEl).setName("Status").addDropdown((d) => {
      this.plugin.settings.statuses.forEach((s) => d.addOption(s, s));
      d.setValue(this.status).onChange((v) => (this.status = v));
    });

    new Setting(contentEl).setName("Priority").addDropdown((d) => {
      this.plugin.settings.priorities.forEach((p) => d.addOption(p, p));
      d.setValue(this.priority).onChange((v) => (this.priority = v));
    });

    const dueSetting = new Setting(contentEl).setName("Due date");
    mountDatePicker(dueSetting.controlEl, {
      cal: this.plugin.calendar,
      value: this.due,
      onChange: (v) => (this.due = v),
    });

    if (!this.isNew && this.file) {
      await this.renderTasksSection(contentEl);
    }

    const btnRow = contentEl.createDiv({ cls: "pm-modal-btns" });
    btnRow.createEl("button", { cls: "pm-btn pm-btn-primary", text: this.isNew ? "Create" : "Save" })
      .addEventListener("click", () => void this.submitAndClose());

    if (!this.isNew && this.file) {
      const f = this.file;
      btnRow.createEl("button", { cls: "pm-btn", text: "Open note" })
        .addEventListener("click", () => {
          this.app.workspace.getLeaf(false).openFile(f);
          this.close();
        });

      btnRow.createEl("button", { cls: "pm-btn pm-btn-danger", text: "Delete" })
        .addEventListener("click", () => this.confirmDelete(f));
    }

    btnRow.createEl("button", { cls: "pm-btn", text: "Cancel" })
      .addEventListener("click", () => this.close());
  }

  /** Every task pointing at this project — open ones first, then closed ones,
   *  each due soonest first, so what needs doing next is at the top. */
  private async renderTasksSection(contentEl: HTMLElement): Promise<void> {
    const file = this.file;
    if (!file) return;
    const slug = file.basename;

    const files = await this.plugin.taskManager.getTasks(this.ws);
    const tasks = files
      .map((f) => ({ file: f, fm: this.app.metadataCache.getFileCache(f)?.frontmatter ?? {} }))
      .filter((t) => linkSlug(t.fm.project) === slug);

    contentEl.createEl("h3", { text: `Tasks (${tasks.length})` });

    if (!tasks.length) {
      contentEl.createDiv({ cls: "pm-db-empty", text: "No tasks for this project yet." });
      return;
    }

    tasks.sort((a, b) => {
      const am = isMutedStatus(normalizeStatus(a.fm.status));
      const bm = isMutedStatus(normalizeStatus(b.fm.status));
      if (am !== bm) return am ? 1 : -1;
      const ad = String(a.fm.due ?? "");
      const bd = String(b.fm.due ?? "");
      if (ad && bd) return ad < bd ? -1 : ad > bd ? 1 : 0;
      return ad ? -1 : bd ? 1 : 0;
    });

    const list = contentEl.createDiv({ cls: "pm-db-list" });
    for (const t of tasks) {
      const status = normalizeStatus(t.fm.status ?? "todo");
      const priority = String(t.fm.priority ?? "medium");
      const due = String(t.fm.due ?? "");

      const item = list.createDiv({ cls: "pm-db-item", attr: { tabindex: "0" } });
      const dot = item.createDiv({ cls: "pm-db-item-dot" });
      dot.setCssStyles({ background: statusColor(status) });
      const main = item.createDiv({ cls: "pm-db-item-main" });
      main.createDiv({ cls: "pm-db-item-title", text: String(t.fm.title ?? t.file.basename) });
      main.createDiv({
        cls: "pm-db-item-meta",
        text: due
          ? `${status} · ${priority} · due ${this.plugin.calendar.label(due)}`
          : `${status} · ${priority}`,
      });
      const hours = Number(t.fm.total_hours ?? 0) || 0;
      item.createDiv({ cls: "pm-db-item-val", text: formatHours(hours) });

      const open = () => {
        this.close();
        this.plugin.openTaskModal(t.file, this.ws);
      };
      item.addEventListener("click", open);
      item.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    }
  }

  /**
   * Deletes the project note, and only that note.
   *
   * Permanent or trashed is the vault owner's setting. Its tasks stay,
   * which the dialog says plainly: they would otherwise be orphaned with no
   * warning, and destroying a whole tree of work behind a single button is not
   * something to do quietly.
   */
  private confirmDelete(file: TFile): void {
    const tasks = this.countTasks(file.basename);
    const tail = tasks
      ? ` Its ${tasks} ${tasks === 1 ? "task stays" : "tasks stay"} in the workspace, with no project.`
      : "";
    new ConfirmModal(this.app, {
      title: "Delete this project?",
      body: `"${this.title}" ${deleteWarning(this.plugin.settings.deleteBehaviour)}.${tail}`,
      confirmText: "Delete",
      onConfirm: async () => {
        await deleteNote(this.app, file, this.plugin.settings.deleteBehaviour);
        new Notice(`Deleted: ${this.title}`);
        this.close();
        this.plugin.refreshTimerViews();
      },
    }).open();
  }

  private countTasks(slug: string): number {
    const folders = taskFolders(this.ws);
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!isUnderAnyFolder(f.path, folders)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm?.type === "task" && linkSlug(fm.project) === slug) n++;
    }
    return n;
  }

  private async submitAndClose(): Promise<void> {
    if (!this.title.trim()) { new Notice("Title is required"); return; }
    await this.save();
    this.close();
  }

  async save(): Promise<void> {
    if (this.isNew) {
      await this.plugin.projectManager.createProject(
        this.ws,
        this.title,
        this.status,
        this.priority,
        this.due
      );
      new Notice(`Project created: ${this.title}`);
    } else if (this.file) {
      await updateFrontmatterFields(this.app, this.file, {
        title: this.title,
        status: this.status,
        priority: this.priority,
        due: this.due,
      });
      await renameHeading(this.app, this.file, this.originalTitle, this.title);
      new Notice(`Project saved: ${this.title}`);
      await this.plugin.syncArchiveFor(this.ws, this.file);
    }
    this.plugin.refreshKanban();
    this.plugin.refreshProjectDashboard();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
