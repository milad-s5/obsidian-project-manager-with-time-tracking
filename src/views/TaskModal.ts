import { App, Modal, TFile, Notice, Setting } from "obsidian";
import ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { endDateFields, linkSlug, renameHeading, updateFrontmatterFields } from "../utils/FrontmatterUtils";
import { todayString } from "../utils/DateUtils";
import { resetTimerWithConfirm, showStopNotice } from "./TimerBar";
import { normalizeStatus } from "../utils/StatusColors";
import { mountDatePicker } from "./DatePicker";
import { ConfirmModal } from "./ConfirmModal";
import { ProjectSuggest } from "./ProjectSuggest";
import { deleteNote, deleteWarning } from "../utils/FileOps";
import {
  isUnderAnyFolder, listProjectOptions, matchProject, ProjectOption, timeEntryFolders,
} from "../utils/WorkspacePaths";
import { isArchivableStatus } from "../managers/ArchiveManager";
import { readNoteSection, writeNoteSection } from "../utils/NoteContent";
import { mountNotesEditor, NotesEditor } from "./NotesEditor";
import { renderTimeEntries } from "./TimeEntriesSection";

export class TaskModal extends Modal {
  plugin: ProjectManagerPlugin;
  file: TFile | null;
  ws: Workspace;
  isNew: boolean;
  /** Readers for the fields features added; each gives values or a reason not to save */
  private extraFields: (() => Record<string, unknown> | string)[] = [];
  private extraValues: Record<string, unknown> = {};
  timerInterval: number | null = null;

  // Form fields
  title = "";
  /** The title as it was when the modal opened, so the H1 can be found */
  private originalTitle = "";
  projectSlug = "";
  /** What is typed in the project box, resolved back to a slug on save */
  private projectText = "";
  /** Only a project box the user actually changed is resolved on save */
  private projectTouched = false;
  private projectOptions: ProjectOption[] = [];
  status = "todo";
  priority = "medium";
  due = "";
  manualHours = "";
  manualDate = "";
  notes = "";
  /** The note as read from the file, so Save only rewrites it when it changed */
  private originalNotes = "";
  private notesEditor: NotesEditor | null = null;

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
   * Projects offerable for a task: the open ones, plus whichever this task
   * already points at, wherever that project now lives.
   *
   * Only the active projects folder used to be read. A closed project sits in
   * the archive, so its tasks opened with an empty project box, and saving
   * them — even just pressing Enter — wrote an empty project over the link.
   */
  private getProjectOptions(): ProjectOption[] {
    return listProjectOptions(this.app, this.ws).filter(
      (p) => p.slug === this.projectSlug || !isArchivableStatus(p.status)
    );
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal");
    if (this.file) {
      this.notes = this.originalNotes = readNoteSection(await this.app.vault.read(this.file));
    }

    // Enter does what the nearest primary button does: inside the manual-time
    // fields that is Add Entry, otherwise Create/Save
    contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const target = e.target as HTMLElement;
      // A new line in the note, not a submit
      if (target.tagName === "TEXTAREA" || target.isContentEditable) return;
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
    if (!this.projectOptions.length && !this.projectSlug) {
      projectSetting.setDesc("No open projects in this workspace yet.");
    } else {
      projectSetting.addText((t) => {
        t.setPlaceholder("Type or pick a project");
        // A project that no longer exists still shows by name, so the link
        // is visible rather than looking empty
        const current = this.projectOptions.find((p) => p.slug === this.projectSlug);
        this.projectText = current ? current.title : this.projectSlug;
        t.setValue(this.projectText);
        t.onChange((v) => {
          this.projectText = v;
          this.projectTouched = true;
        });

        new ProjectSuggest(
          this.app,
          t.inputEl,
          () => this.projectOptions,
          (option) => {
            this.projectText = option.title;
            this.projectSlug = option.slug;
            this.projectTouched = true;
          }
        );
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
      app: this.app,
      cal: this.plugin.calendar,
      value: this.due,
      onChange: (v) => (this.due = v),
    });

    // Fields added by features (estimate, tags and the like)
    const fm = this.file ? this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {} : {};
    this.extraFields = this.plugin.ext.dialogFields
      .filter((f) => f.kinds.includes("task"))
      .map((f) => f.render({ kind: "task", ws: this.ws, file: this.file, fm, container: contentEl }));

    this.notesEditor = mountNotesEditor(contentEl, {
      app: this.app,
      file: this.file,
      value: this.notes,
      onChange: (v) => (this.notes = v),
      onOpenLink: () => this.close(),
    });

    // Time tracking section
    if (!this.isNew && this.file) {
      contentEl.createEl("h3", { text: "Time Tracking" });
      const file = this.file;

      // Totals, and every logged session to fix or remove
      renderTimeEntries(contentEl, this.plugin, this.ws, file);

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
            showStopNotice(await this.plugin.timeTracker.stopTimer(this.ws));
            this.close();
            // Refresh kanban if open
            this.plugin.refreshTimerViews();
          } catch (err) {
            new Notice(err instanceof Error ? err.message : String(err));
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
          } catch (err) {
            new Notice(err instanceof Error ? err.message : String(err));
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
        app: this.app,
        cal: this.plugin.calendar,
        value: this.manualDate,
        placeholder: "Today",
        onChange: (v) => (this.manualDate = v),
      });

      const addBtn = manualDiv.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Add Entry" });
      addBtn.addEventListener("click", async () => {
        // A second click while the first is still writing would log it twice
        if (addBtn.disabled) return;
        const h = parseFloat(this.manualHours);
        if (isNaN(h) || h <= 0) {
          new Notice("Enter a valid number of hours");
          return;
        }
        addBtn.disabled = true;
        try {
          const date = this.manualDate || todayString();
          await this.plugin.timeTracker.addManualEntry(this.ws, file, h, date);
          new Notice(`Added ${h}h for ${date}`);
          this.plugin.refreshTimerViews();
          this.close();
        } catch (err) {
          new Notice(err instanceof Error ? err.message : String(err));
          addBtn.disabled = false;
        }
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

      btnRow.createEl("button", { cls: "pm-btn pm-btn-danger", text: "Delete" })
        .addEventListener("click", () => this.confirmDelete(f));
    }

    btnRow.createEl("button", { cls: "pm-btn", text: "Cancel" })
      .addEventListener("click", () => this.close());
  }

  /**
   * Deletes the task note together with its time entry notes.
   *
   * Whether this is permanent or a trip to the trash is the vault owner's
   * setting, and the dialog says which it will be. The time entries used to
   * be left behind, so a deleted task's hours lived on in the dashboard and
   * the reports with no task to remove them from.
   */
  private confirmDelete(file: TFile): void {
    const entries = this.timeEntryFiles(file.basename);
    const tail = entries.length
      ? ` So ${entries.length === 1 ? "will its time entry" : `will its ${entries.length} time entries`}, and its hours leave the reports.`
      : "";
    new ConfirmModal(this.app, {
      title: "Delete this task?",
      body: `"${this.title}" ${deleteWarning(this.plugin.settings.deleteBehaviour)}.${tail}`,
      confirmText: "Delete",
      onConfirm: async () => {
        if (this.plugin.timeTracker.getActiveTaskPath() === file.path) {
          this.plugin.timeTracker.discard();
        }
        for (const entry of entries) await deleteNote(this.app, entry, this.plugin.settings.deleteBehaviour);
        await deleteNote(this.app, file, this.plugin.settings.deleteBehaviour);
        new Notice(`Deleted: ${this.title}`);
        this.close();
        this.plugin.refreshTimerViews();
      },
    }).open();
  }

  private timeEntryFiles(slug: string): TFile[] {
    const folders = timeEntryFolders(this.ws);
    return this.app.vault.getMarkdownFiles().filter((f) => {
      if (!isUnderAnyFolder(f.path, folders)) return false;
      return linkSlug(this.app.metadataCache.getFileCache(f)?.frontmatter?.task) === slug;
    });
  }

  private async submitAndClose(): Promise<void> {
    if (!this.title.trim()) { new Notice("Title is required"); return; }
    if (!this.resolveProject()) return;
    this.extraValues = {};
    for (const read of this.extraFields) {
      const values = read();
      if (typeof values === "string") { new Notice(values); return; }
      Object.assign(this.extraValues, values);
    }
    // A failed save used to vanish into the console with the dialog still
    // open and nothing said; now it is reported and the dialog stays
    try {
      await this.save();
    } catch (err) {
      new Notice(`Could not save the task: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.close();
  }

  /**
   * Turns whatever is in the project box back into a slug.
   *
   * A typo has to stop the save rather than quietly file the task under no
   * project, which is the kind of thing only noticed weeks later.
   */
  private resolveProject(): boolean {
    // Left alone, the link stays exactly as it was
    if (!this.projectTouched) return true;
    const typed = this.projectText.trim();
    if (!typed) {
      this.projectSlug = "";
      return true;
    }
    const match = matchProject(typed, this.projectOptions);
    if (!match) {
      new Notice(`No open project called "${typed}"`);
      return false;
    }
    this.projectSlug = match.slug;
    return true;
  }

  async save(): Promise<void> {
    if (this.isNew) {
      const file = await this.plugin.taskManager.createTask(
        this.ws,
        this.title,
        this.projectSlug,
        this.status,
        this.priority,
        this.due
      );
      if (Object.keys(this.extraValues).length) {
        await this.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, this.extraValues));
      }
      if (this.notes.trim()) await this.app.vault.process(file, (c) => writeNoteSection(c, this.notes));
      new Notice(`Task created: ${this.title}`);
    } else if (this.file) {
      await updateFrontmatterFields(this.app, this.file, {
        title: this.title,
        project: this.projectSlug ? `[[${this.projectSlug}]]` : "",
        status: this.status,
        ...endDateFields(this.app.metadataCache.getFileCache(this.file)?.frontmatter, this.status),
        priority: this.priority,
        due: this.due,
        ...this.extraValues,
      });
      await renameHeading(this.app, this.file, this.originalTitle, this.title);
      if (this.notes !== this.originalNotes) {
        await this.app.vault.process(this.file, (c) => writeNoteSection(c, this.notes));
      }
      new Notice(`Task saved: ${this.title}`);
      await this.plugin.syncArchiveFor(this.ws, this.file);
    }
    this.plugin.refreshTimerViews();
  }

  onClose(): void {
    if (this.timerInterval !== null) clearInterval(this.timerInterval);
    this.notesEditor?.unload();
    this.contentEl.empty();
  }
}
