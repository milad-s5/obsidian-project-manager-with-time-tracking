import { App, Modal, TFile, Notice, Setting, normalizePath } from "obsidian";
import ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { linkSlug, renameHeading, updateFrontmatterFields } from "../utils/FrontmatterUtils";
import { todayString } from "../utils/DateUtils";
import { resetTimerWithConfirm } from "./TimerBar";
import { normalizeStatus } from "../utils/StatusColors";
import { mountDatePicker } from "./DatePicker";

export class TaskModal extends Modal {
  // Projects not yet started or in progress — only these can be picked for a task
  private static readonly ACTIVE_PROJECT_STATUSES = ["todo", "active"];

  plugin: ProjectManagerPlugin;
  file: TFile | null;
  ws: Workspace;
  isNew: boolean;
  timerInterval: number | null = null;

  // Form fields
  title = "";
  /** The title as it was when the modal opened, so the H1 can be found */
  private originalTitle = "";
  projectSlug = "";
  /** What is typed in the project box, resolved back to a slug on save */
  private projectText = "";
  private projectOptions: { slug: string; title: string }[] = [];
  /** Keeps this modal's <datalist> id from colliding with another one */
  private readonly instanceId = Math.random().toString(36).slice(2);
  status = "todo";
  priority = "medium";
  due = "";
  manualHours = "";
  manualDate = "";

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
      this.projectSlug = linkSlug(fm.project);
      this.status = normalizeStatus(fm.status ?? "todo");
      this.priority = fm.priority ?? "medium";
      this.due = fm.due ?? "";
    }
  }

  /**
   * Projects offerable for a task: open ones, plus whichever this task already
   * points at so that editing an old task cannot silently reassign it.
   *
   * This used to read `<root>/Projects` directly and reach into the folder's
   * children through an `any` cast, which ignored a workspace whose projects
   * folder had been configured elsewhere and leaned on an untyped internal.
   */
  private getProjectOptions(): { slug: string; title: string }[] {
    const folder = normalizePath(this.ws.projectsFolder);
    const out: { slug: string; title: string }[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${folder}/`)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type !== "project") continue;

      const slug = file.basename;
      const title = String(fm.title ?? slug);
      if (slug === this.projectSlug) {
        out.push({ slug, title });
        continue;
      }
      if (TaskModal.ACTIVE_PROJECT_STATUSES.includes(normalizeStatus(fm.status))) {
        out.push({ slug, title });
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal");

    // Enter does what the nearest primary button does: inside the manual-time
    // fields that is Add Entry, otherwise Create/Save
    contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (target.closest(".pm-manual-entry")) {
        contentEl.querySelector<HTMLButtonElement>(".pm-manual-entry .pm-btn-secondary")?.click();
        return;
      }
      void this.submitAndClose();
    });

    contentEl.createEl("h2", { text: this.isNew ? "New Task" : `Task: ${this.title}` });

    new Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(this.title).onChange((v) => (this.title = v));
      if (this.isNew) t.inputEl.focus();
    });

    // Type to narrow, or pick from the list — the same field the board uses to
    // filter by project. A dropdown alone meant scrolling a long list, and it
    // showed file slugs rather than the titles shown everywhere else.
    this.projectOptions = this.getProjectOptions();
    const projectSetting = new Setting(contentEl).setName("Project");
    if (!this.projectOptions.length) {
      projectSetting.setDesc("No open projects in this workspace yet.");
    } else {
      projectSetting.addText((t) => {
        const listId = `pm-task-projects-${this.instanceId}`;
        t.inputEl.setAttribute("list", listId);
        t.setPlaceholder("Type or pick a project");
        const current = this.projectOptions.find((p) => p.slug === this.projectSlug);
        t.setValue(current ? current.title : "");
        this.projectText = current ? current.title : "";
        t.onChange((v) => (this.projectText = v));

        const list = t.inputEl.parentElement?.createEl("datalist", { attr: { id: listId } });
        this.projectOptions.forEach((p) => list?.createEl("option", { value: p.title }));
      });
    }

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

    // Time tracking section
    if (!this.isNew && this.file) {
      contentEl.createEl("h3", { text: "Time Tracking" });
      const file = this.file;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

      const statsDiv = contentEl.createDiv({ cls: "pm-time-stats" });
      statsDiv.createDiv({ text: `Total hours: ${fm.total_hours ?? 0}` });
      statsDiv.createDiv({ text: `Days tracked: ${fm.days_count ?? 0}` });

      // Timer controls
      const timerDiv = contentEl.createDiv({ cls: "pm-timer-controls" });
      const isThisTaskRunning = this.plugin.timeTracker.getActiveTaskPath() === file.path;

      if (isThisTaskRunning) {
        const elapsed = timerDiv.createDiv({ cls: "pm-elapsed-display" });
        elapsed.textContent = this.plugin.timeTracker.getElapsed();
        this.timerInterval = window.setInterval(() => {
          elapsed.textContent = this.plugin.timeTracker.getElapsed();
        }, 1000);

        const pauseBtn = timerDiv.createEl("button", {
          cls: "pm-btn pm-btn-secondary",
          text: this.plugin.timeTracker.isPaused() ? "▶ Resume" : "⏸ Pause",
        });
        pauseBtn.addEventListener("click", () => {
          this.plugin.timeTracker.togglePause();
          const paused = this.plugin.timeTracker.isPaused();
          pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
          elapsed.toggleClass("paused", paused);
          elapsed.textContent = this.plugin.timeTracker.getElapsed();
          this.plugin.refreshTimerViews();
        });

        const resetBtn = timerDiv.createEl("button", {
          cls: "pm-btn pm-btn-secondary",
          text: "⟲ Reset",
        });
        resetBtn.addEventListener("click", () => {
          resetTimerWithConfirm(this.app, this.plugin, () => {
            elapsed.textContent = this.plugin.timeTracker.getElapsed();
            this.plugin.refreshTimerViews();
          });
        });

        const stopBtn = timerDiv.createEl("button", { cls: "pm-btn pm-btn-danger", text: "⏹ Stop Timer" });
        stopBtn.addEventListener("click", async () => {
          try {
            const hours = await this.plugin.timeTracker.stopTimer(this.ws);
            new Notice(`Stopped. Logged ${hours}h`);
            this.close();
            // Refresh kanban if open
            this.plugin.refreshTimerViews();
          } catch (err: any) {
            new Notice(err.message);
          }
        });
      } else {
        const startBtn = timerDiv.createEl("button", {
          cls: "pm-btn pm-btn-primary",
          text: "▶ Start Timer",
        });
        startBtn.addEventListener("click", () => {
          try {
            this.plugin.timeTracker.startTimer(file.path, this.title, this.ws.id);
            new Notice(`Timer started: ${this.title}`);
            this.close();
            this.plugin.refreshTimerViews();
          } catch (err: any) {
            new Notice(err.message);
          }
        });
      }

      // Manual entry
      contentEl.createEl("h4", { text: "Add Manual Entry" });
      const manualDiv = contentEl.createDiv({ cls: "pm-manual-entry" });

      new Setting(manualDiv)
        .setName("Hours")
        .addText((t) =>
          t.setPlaceholder("e.g. 4.5").setValue(this.manualHours).onChange((v) => (this.manualHours = v))
        );

      const dateSetting = new Setting(manualDiv).setName("Date");
      mountDatePicker(dateSetting.controlEl, {
        cal: this.plugin.calendar,
        value: this.manualDate,
        placeholder: "Today",
        onChange: (v) => (this.manualDate = v),
      });

      manualDiv
        .createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Add Entry" })
        .addEventListener("click", async () => {
          const h = parseFloat(this.manualHours);
          if (isNaN(h) || h <= 0) {
            new Notice("Enter a valid number of hours");
            return;
          }
          const date = this.manualDate || todayString();
          await this.plugin.timeTracker.addManualEntry(this.ws, file, h, date);
          new Notice(`Added ${h}h for ${date}`);
          this.plugin.refreshTimerViews();
          this.close();
        });
    }

    // Buttons
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
    }

    btnRow.createEl("button", { cls: "pm-btn", text: "Cancel" })
      .addEventListener("click", () => this.close());
  }

  private async submitAndClose(): Promise<void> {
    if (!this.title.trim()) { new Notice("Title is required"); return; }
    if (!this.resolveProject()) return;
    await this.save();
    this.close();
  }

  /**
   * Turns whatever is in the project box back into a slug.
   *
   * A typo has to stop the save rather than quietly file the task under no
   * project, which is the kind of thing only noticed weeks later.
   */
  private resolveProject(): boolean {
    const typed = this.projectText.trim();
    if (!typed) {
      this.projectSlug = "";
      return true;
    }
    const match =
      this.projectOptions.find((p) => p.title === typed) ??
      this.projectOptions.find((p) => p.title.toLowerCase() === typed.toLowerCase()) ??
      this.projectOptions.find((p) => p.slug.toLowerCase() === typed.toLowerCase());
    if (!match) {
      new Notice(`No open project called "${typed}"`);
      return false;
    }
    this.projectSlug = match.slug;
    return true;
  }

  async save(): Promise<void> {
    if (this.isNew) {
      await this.plugin.taskManager.createTask(
        this.ws,
        this.title,
        this.projectSlug,
        this.status,
        this.priority,
        this.due
      );
      new Notice(`Task created: ${this.title}`);
    } else if (this.file) {
      await updateFrontmatterFields(this.app, this.file, {
        title: this.title,
        project: this.projectSlug ? `[[${this.projectSlug}]]` : "",
        status: this.status,
        priority: this.priority,
        due: this.due,
      });
      await renameHeading(this.app, this.file, this.originalTitle, this.title);
      new Notice(`Task saved: ${this.title}`);
      await this.plugin.syncArchiveFor(this.ws, this.file);
    }
    this.plugin.refreshTimerViews();
  }

  onClose(): void {
    if (this.timerInterval !== null) clearInterval(this.timerInterval);
    this.contentEl.empty();
  }
}
