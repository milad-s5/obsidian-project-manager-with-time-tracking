import { ItemView, WorkspaceLeaf, TFile, Menu, Notice } from "obsidian";
import ProjectManagerPlugin from "../main";
import { Workspace } from "../types";
import { linkSlug, updateFrontmatterFields } from "../utils/FrontmatterUtils";
import { statusColor, priorityColor, isMutedStatus, normalizeStatus } from "../utils/StatusColors";
import { NoteInfo, renderNoteBadge } from "../utils/NoteContent";
import { isArchivedPath, listProjectOptions } from "../utils/WorkspacePaths";
import { captureFocus, restoreFocus } from "../utils/FocusUtils";
import { renderTimerBar, resetTimerWithConfirm, tickTimerDisplays } from "./TimerBar";

export const KANBAN_VIEW_TYPE = "project-manager-kanban";

/** How many cards of a closed column are shown by default */
const COLLAPSED_LIMIT = 8;

export class KanbanView extends ItemView {
  plugin: ProjectManagerPlugin;
  currentWorkspace: Workspace;
  filterProject: string = "";
  filterPriority: string = "";
  filterTask: string = "";
  /** Unique per leaf, so this view's <datalist> id cannot collide with another
   *  Kanban leaf open at the same time */
  private readonly instanceId = Math.random().toString(36).slice(2);
  /** Paths of tasks holding text beyond the template → marker on the card */
  private noted: Map<string, NoteInfo> = new Map();
  /** Closed columns the user expanded — has to survive the next render */
  private expandedCols: Set<string> = new Set();
  private refreshInterval: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ProjectManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentWorkspace = plugin.getCurrentWorkspace();
  }

  getViewType(): string { return KANBAN_VIEW_TYPE; }
  getDisplayText(): string { return "Kanban Board"; }
  getIcon(): string { return "layout-kanban"; }

  async onOpen(): Promise<void> {
    await this.render();
    this.refreshInterval = window.setInterval(() => {
      if (this.plugin.timeTracker.isTicking()) {
        tickTimerDisplays(this.containerEl, this.plugin);
      }
    }, 1000);

    // "changed" rather than vault "modify": modify fires the moment bytes hit
    // the file, before Obsidian has re-parsed the frontmatter, so rendering
    // then reads the *old* values. That is why an edit made outside the app —
    // a git discard, a pull — left the board showing the previous title.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.render()));
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.vault.on("rename", () => this.render()));
  }

  async onClose(): Promise<void> {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
    }
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    // A full render rebuilds every element, including whichever filter input
    // was mid-typing — so its focus and cursor are captured here and put back
    // on the new element afterwards, rather than silently dropping the field.
    const focus = captureFocus(container);
    container.empty();
    container.addClass("pm-kanban-container");

    // Toolbar
    this.renderToolbar(container);

    // Board
    const board = container.createDiv({ cls: "pm-kanban-board" });
    // Focus mode drops every column but "active" rather than filtering cards
    // within each column — the columns themselves are the statuses, so hiding
    // everything but the one that means "being worked on right now" is what
    // "only active tasks" means on a board shaped like this.
    const statuses = this.plugin.focusMode
      ? this.plugin.settings.statuses.filter((s) => normalizeStatus(s) === "active")
      : this.plugin.settings.statuses;
    const tasks = await this.plugin.taskManager.getTasks(this.currentWorkspace);
    this.noted = await this.plugin.noteScanner.scan(tasks);
    const taskQuery = this.filterTask.toLowerCase();
    const projectQuery = this.filterProject.toLowerCase();
    // Matched by title, since that is what the field shows and what the
    // datalist suggests — the slug behind it is never shown to the user.
    const projectTitleBySlug = new Map(listProjectOptions(this.app, this.currentWorkspace).map((p) => [p.slug, p.title]));

    for (const status of statuses) {
      const col = board.createDiv({ cls: "pm-kanban-col" });
      col.setCssProps({ "--pm-status-color": statusColor(status) });
      const colFiltered = tasks.filter((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm) return false;
        if (normalizeStatus(fm.status) !== status) return false;
        if (projectQuery) {
          const slug = linkSlug(fm.project);
          const title = (projectTitleBySlug.get(slug) ?? slug).toLowerCase();
          if (!title.includes(projectQuery)) return false;
        }
        if (this.filterPriority && fm.priority !== this.filterPriority) return false;
        if (taskQuery && !String(fm.title ?? f.basename).toLowerCase().includes(taskQuery)) return false;
        return true;
      });

      // Closed columns only ever grow, and whatever was just closed gets lost at
      // the bottom — so newest first, with the rest behind a button.
      const closed = isMutedStatus(status);
      if (closed) {
        colFiltered.sort((a, b) => b.stat.mtime - a.stat.mtime);
      }
      const expanded = this.expandedCols.has(status);
      const hidden = closed && !expanded ? Math.max(0, colFiltered.length - COLLAPSED_LIMIT) : 0;
      const visible = hidden > 0 ? colFiltered.slice(0, COLLAPSED_LIMIT) : colFiltered;

      col.createDiv({ cls: "pm-col-strip" });
      const header = col.createDiv({ cls: "pm-col-header" });
      header.createSpan({ cls: "pm-col-title", text: status });
      header.createSpan({ cls: "pm-col-count", text: String(colFiltered.length) });

      const cards = col.createDiv({ cls: "pm-col-cards" });
      cards.setAttribute("data-status", status);

      if (colFiltered.length === 0) {
        cards.createDiv({ cls: "pm-col-empty", text: "No tasks here" });
      }
      for (const task of visible) {
        this.renderTaskCard(cards, task, status);
      }

      if (hidden > 0 || (closed && expanded && colFiltered.length > COLLAPSED_LIMIT)) {
        const toggle = cards.createEl("button", {
          cls: "pm-col-more",
          text: hidden > 0 ? `Show ${hidden} older` : "Show fewer",
        });
        toggle.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (expanded) this.expandedCols.delete(status);
          else this.expandedCols.add(status);
          await this.render();
        });
      }

      // Drop zone
      cards.addEventListener("dragover", (e) => { e.preventDefault(); cards.addClass("pm-drag-over"); });
      cards.addEventListener("dragleave", () => cards.removeClass("pm-drag-over"));
      cards.addEventListener("drop", async (e) => {
        e.preventDefault();
        cards.removeClass("pm-drag-over");
        const taskPath = e.dataTransfer?.getData("text/plain");
        if (!taskPath) return;
        const file = this.app.vault.getAbstractFileByPath(taskPath) as TFile | null;
        if (!file) return;
        await updateFrontmatterFields(this.app, file, { status });
        await this.plugin.syncArchiveFor(this.currentWorkspace, file);
        await this.render();
      });
    }

    restoreFocus(container, focus);
  }

  /**
   * Finds task files Obsidian's index disagrees with disk about, and makes it
   * re-read them.
   *
   * When something writes to the vault behind Obsidian's back — a git discard,
   * a pull, an editor outside the app — Obsidian can go on serving the metadata
   * it parsed before, and no plugin event ever fires. The board then shows the
   * old title until the note is opened, which is what finally forces a re-read.
   *
   * Comparing the adapter's mtime with the one on the cached file object is how
   * that disagreement becomes visible. Writing the content straight back
   * through the vault is what resolves it: the read comes from disk, so the
   * index is rebuilt from what is actually there. The bytes are unchanged, so
   * git sees nothing; only the modification time moves.
   */
  private async reindexStaleFiles(): Promise<number> {
    const files = await this.plugin.taskManager.getTasks(this.currentWorkspace);
    let stale = 0;

    for (const file of files) {
      let onDisk: { mtime: number } | null = null;
      try {
        onDisk = await this.app.vault.adapter.stat(file.path);
      } catch {
        continue; // gone or unreadable — the next render will drop it
      }
      if (!onDisk || onDisk.mtime === file.stat.mtime) continue;

      stale++;
      try {
        await this.app.vault.process(file, (content) => content);
      } catch {
        // Locked or read-only; the count still tells the user what is going on
      }
    }
    return stale;
  }

  renderTaskCard(container: HTMLElement, file: TFile, status: string): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const card = container.createDiv({ cls: "pm-task-card" });
    card.setAttribute("draggable", "true");
    card.setAttribute("data-path", file.path);

    const activePath = this.plugin.timeTracker.getActiveTaskPath();
    if (this.plugin.timeTracker.isRunning()) {
      card.addClass(activePath === file.path ? "pm-task-active" : "pm-task-inactive");
    }
    if (isMutedStatus(status) && activePath !== file.path) {
      card.addClass("pm-card-muted");
    }

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", file.path);
      card.addClass("pm-dragging");
    });
    card.addEventListener("dragend", () => card.removeClass("pm-dragging"));

    // Title + priority dot
    const head = card.createDiv({ cls: "pm-card-head" });
    head.createDiv({ cls: "pm-card-title", text: fm.title ?? file.basename });
    const notes = this.noted.get(file.path);
    if (notes) renderNoteBadge(head, notes);
    if (isArchivedPath(this.currentWorkspace, file.path)) {
      head.createSpan({
        cls: "pm-archived-badge",
        text: "🗄",
        attr: { "aria-label": "Archived — the file lives in the archive folder" },
      });
    }
    const prDot = head.createDiv({ cls: "pm-pr-dot" });
    prDot.setCssProps({ "--pm-priority-color": priorityColor(fm.priority ?? "medium") });
    prDot.setAttribute("aria-label", `Priority: ${fm.priority ?? "medium"}`);

    // Meta row — project · due · hours, all on one line
    const meta = card.createDiv({ cls: "pm-card-meta" });
    if (fm.project) {
      meta.createSpan({ text: `📁 ${linkSlug(fm.project)}` });
    }
    if (fm.due) {
      const isOverdue = fm.due < new Date().toISOString().slice(0, 10) && status !== "done";
      if (fm.project) meta.createSpan({ cls: "pm-meta-dot" });
      meta.createSpan({ cls: isOverdue ? "pm-overdue" : "", text: `📅 ${this.plugin.calendar.label(fm.due)}` });
    }
    meta.createSpan({ cls: "pm-card-hours", text: `⏱ ${fm.total_hours ?? 0}h` });

    // Timer indicator
    if (activePath === file.path) {
      const isPaused = this.plugin.timeTracker.isPaused();
      const timerDiv = card.createDiv({ cls: `pm-card-timer${isPaused ? " paused" : ""}` });
      timerDiv.createSpan({ cls: "pm-timer-dot" });
      timerDiv.createSpan({ cls: "pm-timer-elapsed", text: this.plugin.timeTracker.getElapsed() });
      if (isPaused) timerDiv.createSpan({ cls: "pm-timer-badge", text: "paused" });
    }

    // Click to open task modal
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".pm-card-timer")) return;
      this.plugin.openTaskModal(file, this.currentWorkspace);
    });

    // Right-click context menu
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Open note").setIcon("file-text").onClick(() => {
          this.app.workspace.getLeaf(false).openFile(file);
        })
      );
      menu.addItem((item) =>
        item.setTitle("Start timer").setIcon("play").onClick(async () => {
          try {
            this.plugin.timeTracker.startTimer(file.path, fm.title ?? file.basename, this.currentWorkspace.id);
            new Notice(`Timer started: ${fm.title}`);
            await this.render();
          } catch (err: any) {
            new Notice(err.message);
          }
        })
      );
      if (this.plugin.timeTracker.getActiveTaskPath() === file.path) {
        const paused = this.plugin.timeTracker.isPaused();
        menu.addItem((item) =>
          item
            .setTitle(paused ? "Resume timer" : "Pause timer")
            .setIcon(paused ? "play" : "pause")
            .onClick(async () => {
              this.plugin.timeTracker.togglePause();
              await this.render();
            })
        );
        menu.addItem((item) =>
          item.setTitle("Reset timer").setIcon("rotate-ccw").onClick(() => {
            resetTimerWithConfirm(this.app, this.plugin, () => void this.render());
          })
        );
        menu.addItem((item) =>
          item.setTitle("Stop timer").setIcon("square").onClick(async () => {
            try {
              const hours = await this.plugin.timeTracker.stopTimer(this.currentWorkspace);
              new Notice(`Stopped. Logged ${hours}h`);
              await this.render();
            } catch (err: any) {
              new Notice(err.message);
            }
          })
        );
      }
      menu.showAtMouseEvent(e);
    });
  }

  renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "pm-toolbar" });

    // Three groups, each wrapping as a unit rather than shedding one button at
    // a time onto its own line: which workspace, how the board is narrowed
    // down, and what you can do to it.
    const context = toolbar.createDiv({ cls: "pm-toolbar-group" });
    const filters = toolbar.createDiv({ cls: "pm-toolbar-group" });
    const actions = toolbar.createDiv({ cls: "pm-toolbar-group" });

    // Workspace selector
    const wsSelect = context.createEl("select", { cls: "pm-ws-select" });
    this.plugin.settings.workspaces.forEach((ws) => {
      const opt = wsSelect.createEl("option", { value: ws.id, text: ws.name });
      if (ws.id === this.currentWorkspace.id) opt.selected = true;
    });
    wsSelect.addEventListener("change", async () => {
      const ws = this.plugin.settings.workspaces.find((w) => w.id === wsSelect.value);
      // setCurrentWorkspace refreshes this board and the Project Dashboard's,
      // so switching here is reflected there too.
      if (ws) await this.plugin.setCurrentWorkspace(ws);
    });

    // Filter by project — a text field backed by a <datalist> of real project
    // titles, so both ways of narrowing it down work: pick one from the list,
    // or just type part of a name. Matching is by title (see render()), never
    // by the file slug, which is never shown anywhere for a user to type.
    const projListId = `pm-project-list-${this.instanceId}`;
    const projInput = filters.createEl("input", {
      cls: "pm-filter-input",
      type: "text",
      placeholder: "Filter project...",
      attr: { "data-filter": "project", list: projListId },
    });
    projInput.value = this.filterProject;
    projInput.addEventListener("input", async () => {
      this.filterProject = projInput.value.trim();
      await this.render();
    });
    const projList = filters.createEl("datalist", { attr: { id: projListId } });
    listProjectOptions(this.app, this.currentWorkspace).forEach((p) => projList.createEl("option", { value: p.title }));

    // Filter by task title
    const taskInput = filters.createEl("input", {
      cls: "pm-filter-input",
      type: "text",
      placeholder: "Filter task...",
      attr: { "data-filter": "task" },
    });
    taskInput.value = this.filterTask;
    taskInput.addEventListener("input", async () => {
      this.filterTask = taskInput.value.trim();
      await this.render();
    });

    // Filter by priority
    const prioSelect = filters.createEl("select", { cls: "pm-filter-select" });
    prioSelect.createEl("option", { value: "", text: "All priorities" });
    this.plugin.settings.priorities.forEach((p) => {
      const opt = prioSelect.createEl("option", { value: p, text: p });
      if (p === this.filterPriority) opt.selected = true;
    });
    prioSelect.addEventListener("change", async () => {
      this.filterPriority = prioSelect.value;
      await this.render();
    });

    // Focus mode — shared on the plugin, so toggling it here also redraws the
    // Project Dashboard board the same way.
    const focusBtn = actions.createEl("button", {
      cls: `pm-btn pm-btn-secondary${this.plugin.focusMode ? " pm-btn-toggle-on" : ""}`,
      text: "◎ Focus",
      attr: { "aria-label": "Show only active items", "aria-pressed": String(this.plugin.focusMode) },
    });
    focusBtn.addEventListener("click", () => this.plugin.toggleFocusMode());

    // New task button
    actions.createEl("button", { cls: "pm-btn pm-btn-primary", text: "+ New Task" })
      .addEventListener("click", () => {
        this.plugin.openNewTaskModal(this.currentWorkspace);
      });

    // New project button
    actions.createEl("button", { cls: "pm-btn pm-btn-primary", text: "+ New Project" })
      .addEventListener("click", () => {
        this.plugin.openNewProjectModal(this.currentWorkspace);
      });

    // Project dashboard button
    actions.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Project Dashboard" })
      .addEventListener("click", () => {
        this.plugin.openProjectDashboard();
      });

    // A way out when a card is showing something stale. The board redraws on
    // metadata events, but a file changed outside Obsidian — a git discard, a
    // pull — is only noticed once Obsidian itself re-indexes it, and nothing a
    // plugin can do forces that. Reload re-reads the files and says so plainly.
    const reload = actions.createEl("button", {
      cls: "pm-btn pm-btn-secondary",
      text: "↻ Reload",
      attr: { "aria-label": "Re-read the task files and redraw the board" },
    });
    reload.addEventListener("click", async () => {
      const stale = await this.reindexStaleFiles();
      await this.render();
      new Notice(
        stale > 0
          ? `Board reloaded — ${stale} file(s) had changed outside Obsidian`
          : "Board reloaded"
      );
    });

    // Active timer display
    renderTimerBar(toolbar, this.plugin, this.currentWorkspace, () => void this.render());
  }
}
