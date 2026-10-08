import { ItemView, WorkspaceLeaf, TFile, Menu, Notice, setIcon } from "obsidian";
import ProjectManagerPlugin from "../main";
import { DEFAULT_LANE_LABEL_WIDTH, Workspace } from "../types";
import { endDateFields, linkSlug, updateFrontmatterFields } from "../utils/FrontmatterUtils";
import { priorityColor, isBacklogStatus, isClosedStatus, isMutedStatus, normalizeStatus } from "../utils/StatusColors";
import { renderBoardColumn, renderFullscreenButton, renderMoreMenu } from "./BoardColumn";
import { NoteInfo, renderNoteBadge } from "../utils/NoteContent";
import {
  isArchivedPath, isUnderAnyFolder, listProjectOptions, matchProject, projectFolders, taskFolders,
} from "../utils/WorkspacePaths";
import { captureFocus, restoreFocus } from "../utils/FocusUtils";
import { renderTimerBar, resetTimerWithConfirm, showStopNotice, tickTimerDisplays } from "./TimerBar";
import { ProjectSuggest } from "./ProjectSuggest";
import { todayISO } from "../utils/Jalali";
import { groupByProject, ProjectFacts, ProjectGroup, projectRanking, renderGroupHeading } from "./ProjectGroups";

export const KANBAN_VIEW_TYPE = "project-manager-kanban";

/** How many cards of a closed column are shown by default */
const COLLAPSED_LIMIT = 8;

/** Bounds of the names column beside the project rows */
const MIN_LABEL_WIDTH = 110;
const MAX_LABEL_WIDTH = 480;

export class KanbanView extends ItemView {
  plugin: ProjectManagerPlugin;
  currentWorkspace: Workspace;
  filterProject: string = "";
  filterPriority: string = "";
  filterTask: string = "";
  /** Paths of tasks holding text beyond the template → marker on the card */
  private noted: Map<string, NoteInfo> = new Map();
  /** Closed columns the user expanded — has to survive the next render */
  private expandedCols: Set<string> = new Set();
  private refreshInterval: number | null = null;
  /** Project titles by file name, for the cards — the title is what people know a project by */
  private projectTitles: Map<string, string> = new Map();
  private renderTimer: number | null = null;
  /** Cards are grouped by project, so they leave the project off */
  private grouped = false;

  constructor(leaf: WorkspaceLeaf, plugin: ProjectManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentWorkspace = plugin.getCurrentWorkspace();
  }

  getViewType(): string { return KANBAN_VIEW_TYPE; }
  getDisplayText(): string { return "Kanban board"; }
  getIcon(): string { return "layout-kanban"; }

  async onOpen(): Promise<void> {
    await this.render();
    // Esc leaves full screen, unless a dialog or menu is what it should close
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !this.plugin.settings.boardFullscreen) return;
      if (this.app.workspace.getActiveViewOfType(ItemView) !== this) return;
      if (document.querySelector(".modal-container, .menu, .suggestion-container")) return;
      void this.plugin.toggleBoardFullscreen();
    });
    this.refreshInterval = window.setInterval(() => {
      if (this.plugin.timeTracker.isTicking()) {
        tickTimerDisplays(this.containerEl, this.plugin);
      }
    }, 1000);

    // "changed" rather than vault "modify": modify fires the moment bytes hit
    // the file, before Obsidian has re-parsed the frontmatter, so rendering
    // then reads the *old* values. That is why an edit made outside the app —
    // a git discard, a pull — left the board showing the previous title.
    //
    // Only changes inside this workspace's folders count, and a burst of them
    // makes one redraw. Every edit anywhere in the vault used to redraw the
    // whole board twice, which jumped it back to the top while you typed in
    // a note next to it.
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.onVaultChange(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => this.onVaultChange(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onVaultChange(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onVaultChange(file.path, oldPath)));
  }

  async onClose(): Promise<void> {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
    }
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }

  private onVaultChange(...paths: string[]): void {
    const ws = this.currentWorkspace;
    const folders = [...taskFolders(ws), ...projectFolders(ws)];
    if (paths.some((p) => isUnderAnyFolder(p, folders))) this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.render();
    }, 250);
  }

  async render(): Promise<void> {
    this.containerEl.toggleClass("pm-fullscreen", this.plugin.settings.boardFullscreen);
    const container = this.contentEl;
    // A full render rebuilds every element, including whichever filter input
    // was mid-typing — so its focus and cursor are captured here and put back
    // on the new element afterwards, rather than silently dropping the field.
    const focus = captureFocus(container);
    // So is where the board was scrolled to, across and within each column
    const scroll = {
      top: container.scrollTop,
      left: container.querySelector<HTMLElement>(".pm-kanban-board")?.scrollLeft ?? 0,
      boardTop: container.querySelector<HTMLElement>(".pm-kanban-board")?.scrollTop ?? 0,
      cols: new Map(
        Array.from(container.querySelectorAll<HTMLElement>(".pm-col-cards")).map(
          (el) => [el.getAttribute("data-status") ?? "", el.scrollTop] as const
        )
      ),
    };
    container.empty();
    container.addClass("pm-kanban-container");
    container.setAttribute("dir", this.plugin.settings.boardDirection);

    // Toolbar
    this.renderToolbar(container);

    // Board
    const board = container.createDiv({ cls: "pm-kanban-board" });
    const grouping = this.plugin.settings.groupByProject ? this.plugin.settings.projectGrouping : null;
    this.grouped = grouping !== null;
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
    // suggester offers — the slug behind it is never shown to the user.
    const projectOptions = listProjectOptions(this.app, this.currentWorkspace);
    const projectTitleBySlug = new Map(projectOptions.map((p) => [p.slug, p.title]));
    // Finished projects are kept off the board, tasks and all
    const hiddenStatuses = new Set(this.plugin.settings.hiddenProjectStatuses.map((s) => normalizeStatus(s)));
    const hiddenProjects = new Set(projectOptions.filter((p) => hiddenStatuses.has(p.status)).map((p) => p.slug));
    const visibleTasks = hiddenProjects.size
      ? tasks.filter((t) => !hiddenProjects.has(linkSlug(this.app.metadataCache.getFileCache(t)?.frontmatter?.project)))
      : tasks;
    this.projectTitles = projectTitleBySlug;

    const columns = statuses.map((status) => ({ status, files: this.columnTasks(visibleTasks, status, taskQuery, projectQuery, projectTitleBySlug) }));
    const slugOf = (f: TFile) => linkSlug(this.app.metadataCache.getFileCache(f)?.frontmatter?.project);
    const titleOf = (slug: string) => projectTitleBySlug.get(slug) ?? slug;
    // Rows run across every column, so they come from all the columns' tasks
    const rank = grouping ? this.projectRank(tasks, projectOptions) : new Map<string, number>();
    const lanes = grouping === "lanes" ? groupByProject(columns.flatMap((c) => c.files), slugOf, titleOf, rank) : [];
    if (grouping === "lanes") this.renderLaneLabels(board, lanes, statuses);

    for (const [i, { status, files: colFiltered }] of columns.entries()) {
      const closed = isMutedStatus(status);
      const expanded = this.expandedCols.has(status);
      const hidden = closed && !expanded ? Math.max(0, colFiltered.length - COLLAPSED_LIMIT) : 0;
      const visible = hidden > 0 ? colFiltered.slice(0, COLLAPSED_LIMIT) : colFiltered;

      const { col, cards } = renderBoardColumn(board, {
        status,
        count: colFiltered.length,
        collapsed: this.plugin.isColumnCollapsed("tasks", status),
        onToggle: async (collapsed) => {
          await this.plugin.setColumnCollapsed("tasks", status, collapsed);
          // As rows, the board's grid holds the column widths
          if (grouping === "lanes") await this.render();
        },
        onDrop: async (taskPath) => {
          // Only a task belongs here: a project card dragged across from the
          // Projects board in another pane used to get the task status written
          // into it
          const file = this.app.vault.getAbstractFileByPath(taskPath);
          if (!(file instanceof TFile)) return;
          if (this.app.metadataCache.getFileCache(file)?.frontmatter?.type !== "task") return;
          const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
          await updateFrontmatterFields(this.app, file, { status, ...endDateFields(fm, status) });
          await this.plugin.syncArchiveFor(this.currentWorkspace, file);
          await this.render();
        },
        addLabel: "task",
        onAdd: () => {
          // Same as quick-add: take the board's filters, so the new task
          // lands where it can be seen
          const project = matchProject(this.filterProject, listProjectOptions(this.app, this.currentWorkspace));
          this.plugin.openNewTaskModal(this.currentWorkspace, {
            status,
            priority: this.filterPriority || undefined,
            projectSlug: project?.slug,
          });
        },
      });
      if (isBacklogStatus(status)) this.renderQuickAdd(col, cards, status);

      if (grouping === "lanes") {
        // Every piece of the column is placed in the board's own grid: the
        // head in the first row, a cell in each project's row, and behind
        // them a box drawing the column. One grid sizes each row to its
        // tallest cell, so a long title grows its row in every column.
        const gridColumn = String(i + 2);
        col.addClass("pm-lane-col");
        const top = createDiv({ cls: "pm-lane-top" });
        Array.from(col.children).forEach((el) => { if (el !== cards) top.appendChild(el); });
        col.insertBefore(top, cards);
        top.setCssStyles({ gridColumn, gridRow: "1" });
        const box = createDiv({ cls: "pm-lane-colbox", attr: { "data-status": status } });
        col.insertBefore(box, top);
        box.setCssStyles({ gridColumn, gridRow: "1 / -1" });
        this.renderLaneCells(cards, lanes, colFiltered, status, closed, expanded, slugOf, gridColumn);
      } else if (colFiltered.length === 0) {
        cards.createDiv({ cls: "pm-col-empty", text: "No tasks here" });
      } else if (grouping === "columns") {
        this.renderColumnGroups(cards, visible, status, slugOf, titleOf, rank);
      } else {
        for (const task of visible) this.renderTaskCard(cards, task, status);
      }
      const header = col.querySelector<HTMLElement>(".pm-col-header");
      if (header) {
        for (const decorate of this.plugin.ext.columnDecorators) {
          decorate({ board: "tasks", ws: this.currentWorkspace, status, count: colFiltered.length, col, header, cards });
        }
      }

      if (grouping !== "lanes") this.renderMoreButton(cards, status, hidden, closed && expanded && colFiltered.length > COLLAPSED_LIMIT);
    }

    board.scrollLeft = scroll.left;
    board.scrollTop = scroll.boardTop;
    container.scrollTop = scroll.top;
    board.querySelectorAll<HTMLElement>(".pm-col-cards").forEach((el) => {
      el.scrollTop = scroll.cols.get(el.getAttribute("data-status") ?? "") ?? 0;
    });
    restoreFocus(container, focus);
  }

  /** "Show N older" under a closed column's newest cards, or "Show fewer" once they are all out */
  private renderMoreButton(parent: HTMLElement, status: string, hidden: number, canFold: boolean): void {
    if (hidden <= 0 && !canFold) return;
    const expanded = this.expandedCols.has(status);
    const toggle = parent.createEl("button", {
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

  private groupHours(files: TFile[]): number {
    return files.reduce((sum, f) => sum + (Number(this.app.metadataCache.getFileCache(f)?.frontmatter?.total_hours) || 0), 0);
  }

  /** Inside one column: each project's tasks together under a heading that folds */
  private renderColumnGroups(
    cards: HTMLElement, files: TFile[], status: string, slugOf: (f: TFile) => string, titleOf: (slug: string) => string,
    rank: Map<string, number>
  ): void {
    for (const group of groupByProject(files, slugOf, titleOf, rank)) {
      const box = cards.createDiv({ cls: "pm-group" });
      const collapsed = this.plugin.isProjectGroupCollapsed(this.currentWorkspace, group.slug);
      box.toggleClass("is-collapsed", collapsed);
      renderGroupHeading(box, {
        group,
        count: group.files.length,
        hours: this.groupHours(group.files),
        collapsed,
        onToggle: (c) => {
          box.toggleClass("is-collapsed", c);
          void this.plugin.setProjectGroupCollapsed(this.currentWorkspace, group.slug, c);
        },
        ...this.pinOptions(group.slug),
      });
      const list = box.createDiv({ cls: "pm-group-cards" });
      for (const task of group.files) this.renderTaskCard(list, task, status);
    }
  }

  /** The first column of the rows: each project's name, task count and hours */
  private renderLaneLabels(board: HTMLElement, lanes: ProjectGroup[], statuses: string[]): void {
    board.addClass("pm-lanes");
    board.setCssStyles({
      gridTemplateColumns: ["var(--pm-lane-label-w)", ...statuses.map((st) => (this.plugin.isColumnCollapsed("tasks", st) ? "40px" : "260px"))].join(" "),
      // max-content, not auto: the board has a fixed height, and auto rows
      // shrink to fit it, squeezing the cards over each other
      gridTemplateRows: `repeat(${Math.max(1, lanes.length) + 1}, max-content)`,
    });
    board.setCssProps({ "--pm-lane-label-w": `${this.plugin.settings.laneLabelWidth}px` });
    const labels = board.createDiv({ cls: "pm-lane-labels" });
    const corner = labels.createDiv({ cls: "pm-lane-corner" });
    corner.setCssStyles({ gridColumn: "1", gridRow: "1" });
    this.renderResizeHandle(board, corner);
    if (!lanes.length) labels.createDiv({ cls: "pm-lane-label" }).setCssStyles({ gridColumn: "1", gridRow: "2" });
    for (const [k, lane] of lanes.entries()) {
      const collapsed = this.plugin.isProjectGroupCollapsed(this.currentWorkspace, lane.slug);
      const cell = labels.createDiv({ cls: "pm-lane-label", attr: { "data-lane": lane.slug } });
      cell.setCssStyles({ gridColumn: "1", gridRow: String(k + 2) });
      cell.toggleClass("is-collapsed", collapsed);
      renderGroupHeading(cell, {
        group: lane,
        count: lane.files.length,
        hours: this.groupHours(lane.files),
        collapsed,
        onToggle: (c) => {
          board.querySelectorAll(`[data-lane="${CSS.escape(lane.slug)}"]`).forEach((el) => el.toggleClass("is-collapsed", c));
          void this.plugin.setProjectGroupCollapsed(this.currentWorkspace, lane.slug, c);
        },
        ...this.pinOptions(lane.slug),
      });
      this.renderResizeHandle(board, cell);
    }
  }

  /** A project's pin and link; the "No project" group has neither */
  private pinOptions(slug: string): { pinned?: boolean; onPin?: () => void; onOpen?: () => void } {
    if (!slug) return {};
    return {
      pinned: this.plugin.isProjectPinned(this.currentWorkspace, slug),
      onPin: () => void this.plugin.toggleProjectPinned(this.currentWorkspace, slug),
      onOpen: () => this.openProject(slug),
    };
  }

  /** The project's own dialog, as clicking it on the projects board does */
  private openProject(slug: string): void {
    const file = this.app.metadataCache.getFirstLinkpathDest(slug, "");
    if (!file || this.app.metadataCache.getFileCache(file)?.frontmatter?.type !== "project") {
      new Notice(`Project "${slug}" not found`);
      return;
    }
    this.plugin.openProjectModal(file, this.currentWorkspace);
  }

  /**
   * The edge of the names column, dragged to make it wider or narrower so
   * long names fit on one line. Double-click puts it back.
   */
  private renderResizeHandle(board: HTMLElement, cell: HTMLElement): void {
    const handle = cell.createDiv({ cls: "pm-lane-resize", attr: { "aria-label": "Drag to resize the names, double-click to reset" } });
    const setWidth = (w: number) => board.setCssProps({ "--pm-lane-label-w": `${w}px` });
    handle.addEventListener("click", (e) => e.stopPropagation());
    handle.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      setWidth(DEFAULT_LANE_LABEL_WIDTH);
      void this.plugin.setLaneLabelWidth(DEFAULT_LANE_LABEL_WIDTH);
    });
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Dragging towards the board widens it, which is leftwards right to left
      const rtl = board.closest("[dir]")?.getAttribute("dir") === "rtl";
      const startX = e.clientX;
      const startW = this.plugin.settings.laneLabelWidth;
      let width = startW;
      handle.setPointerCapture(e.pointerId);
      board.addClass("is-resizing");
      const move = (ev: PointerEvent) => {
        const dx = rtl ? startX - ev.clientX : ev.clientX - startX;
        width = Math.round(Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, startW + dx)));
        setWidth(width);
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        board.removeClass("is-resizing");
        void this.plugin.setLaneLabelWidth(width);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }

  /** What each project is ordered by, from all of the workspace's tasks */
  private projectRank(tasks: TFile[], options: { slug: string; title: string; priority: string }[]): Map<string, number> {
    const bySlug = new Map(options.map((p) => [p.slug, p]));
    const priorities = this.plugin.settings.priorities;
    const level = (p: string | undefined) => {
      const i = priorities.indexOf(p ?? "");
      return i === -1 ? priorities.indexOf("medium") : i;
    };
    const facts = new Map<string, ProjectFacts>();
    for (const task of tasks) {
      const fm = this.app.metadataCache.getFileCache(task)?.frontmatter;
      const slug = linkSlug(fm?.project);
      let f = facts.get(slug);
      if (!f) {
        f = {
          slug,
          title: bySlug.get(slug)?.title ?? slug,
          pinned: !!slug && this.plugin.isProjectPinned(this.currentWorkspace, slug),
          lastActive: 0,
          priority: level(bySlug.get(slug)?.priority),
          open: 0,
        };
        facts.set(slug, f);
      }
      f.lastActive = Math.max(f.lastActive, task.stat.mtime);
      if (!isClosedStatus(fm?.status)) f.open++;
    }
    return projectRanking([...facts.values()], this.plugin.settings.projectOrder);
  }

  /** One column's cell in every row; a folded row keeps only how many it holds */
  private renderLaneCells(
    cards: HTMLElement, lanes: ProjectGroup[], files: TFile[], status: string,
    closed: boolean, expanded: boolean, slugOf: (f: TFile) => string, gridColumn: string
  ): void {
    if (!lanes.length) {
      const cell = cards.createDiv({ cls: "pm-lane-cell" });
      cell.setCssStyles({ gridColumn, gridRow: "2" });
      cell.createDiv({ cls: "pm-col-empty", text: "No tasks here" });
      return;
    }
    for (const [k, lane] of lanes.entries()) {
      const mine = files.filter((f) => slugOf(f) === lane.slug);
      const cell = cards.createDiv({ cls: "pm-lane-cell", attr: { "data-lane": lane.slug } });
      cell.setCssStyles({ gridColumn, gridRow: String(k + 2) });
      cell.toggleClass("is-collapsed", this.plugin.isProjectGroupCollapsed(this.currentWorkspace, lane.slug));
      cell.createDiv({ cls: "pm-lane-folded", text: mine.length ? String(mine.length) : "" });
      const list = cell.createDiv({ cls: "pm-lane-cards" });
      const hidden = closed && !expanded ? Math.max(0, mine.length - COLLAPSED_LIMIT) : 0;
      for (const task of hidden > 0 ? mine.slice(0, COLLAPSED_LIMIT) : mine) this.renderTaskCard(list, task, status);
      this.renderMoreButton(list, status, hidden, closed && expanded && mine.length > COLLAPSED_LIMIT);
    }
  }

  /** One column's tasks after the filters, in the order the column shows them */
  private columnTasks(
    tasks: TFile[], status: string, taskQuery: string, projectQuery: string, projectTitleBySlug: Map<string, string>
  ): TFile[] {
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
    if (isMutedStatus(status)) {
      colFiltered.sort((a, b) => b.stat.mtime - a.stat.mtime);
    } else if (["backlog", "todo", "active"].includes(normalizeStatus(status))) {
      const priorities = this.plugin.settings.priorities;
      const rank = (f: TFile) => {
        const p = String(this.app.metadataCache.getFileCache(f)?.frontmatter?.priority ?? "medium").toLowerCase();
        const idx = priorities.indexOf(p);
        return idx === -1 ? priorities.indexOf("medium") : idx;
      };
      colFiltered.sort((a, b) => rank(b) - rank(a));
    }

    const runningPath = this.plugin.timeTracker.getActiveTaskPath();
    if (runningPath) {
      const idx = colFiltered.findIndex((f) => f.path === runningPath);
      if (idx > 0) {
        const [running] = colFiltered.splice(idx, 1);
        colFiltered.unshift(running);
      }
    }

    return colFiltered;
  }

  /**
   * One line, Enter, next — a backlog is only worth keeping if dropping
   * something into it costs nothing. The task takes the board's filters, so it
   * does not vanish the moment it is added: the project when the filter names
   * exactly one, and the priority when one is picked.
   */
  private renderQuickAdd(col: HTMLElement, cards: HTMLElement, status: string): void {
    const input = createEl("input", {
      cls: "pm-col-quickadd",
      type: "text",
      placeholder: "Add to backlog…",
      // The key captureFocus looks for, so the field stays focused across the
      // re-render each new task triggers
      attr: { "data-filter": "quick-add" },
    });
    col.insertBefore(input, cards);

    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = "";
      const project = matchProject(this.filterProject, listProjectOptions(this.app, this.currentWorkspace)) ?? undefined;
      await this.plugin.taskManager.createTask(
        this.currentWorkspace,
        title,
        project?.slug ?? "",
        status,
        this.filterPriority || "medium",
        ""
      );
      new Notice(project ? `Added to backlog · ${project.title}` : "Added to backlog");
    });
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
    // A timer on no task yet dims nothing: no card is being worked on
    if (activePath) {
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
    const showProject = !!fm.project && !this.grouped;
    if (showProject) {
      const slug = linkSlug(fm.project);
      const link = meta.createSpan({ cls: "pm-card-project", text: `📁 ${this.projectTitles.get(slug) ?? slug}` });
      link.setAttr("aria-label", "Open the project");
      link.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openProject(slug);
      });
    }
    if (fm.due) {
      // The local date, as the dashboard uses; the UTC one made a task due
      // today look overdue on an American evening, and kept yesterday's from
      // looking overdue until 03:30 in Tehran
      const isOverdue = fm.due < todayISO()
        && !isMutedStatus(status) && !isBacklogStatus(status);
      if (showProject) meta.createSpan({ cls: "pm-meta-dot" });
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

    for (const decorate of this.plugin.ext.cardDecorators) {
      decorate({ board: "tasks", file, fm, ws: this.currentWorkspace, card, head, meta });
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
          } catch (err) {
            new Notice(err instanceof Error ? err.message : String(err));
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
              showStopNotice(await this.plugin.timeTracker.stopTimer(this.currentWorkspace));
              await this.render();
            } catch (err) {
              new Notice(err instanceof Error ? err.message : String(err));
            }
          })
        );
      }
      for (const add of this.plugin.ext.cardMenuItems) {
        add({ board: "tasks", file, fm, ws: this.currentWorkspace, menu });
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

    // Filter by project — type part of a name or pick from the suggestions.
    // Matching is by title (see render()), never by the file slug, which is
    // never shown anywhere for a user to type.
    const projInput = filters.createEl("input", {
      cls: "pm-filter-input",
      type: "text",
      placeholder: "Filter project...",
      attr: { "data-filter": "project" },
    });
    projInput.value = this.filterProject;
    projInput.addEventListener("input", async () => {
      this.filterProject = projInput.value.trim();
      await this.render();
    });
    new ProjectSuggest(
      this.app,
      projInput,
      () => listProjectOptions(this.app, this.currentWorkspace),
      (option) => {
        this.filterProject = option.title;
        void this.render();
      }
    );

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
    const groupOn = this.plugin.settings.groupByProject;
    const groupBtn = actions.createEl("button", {
      cls: `pm-btn pm-btn-secondary pm-group-btn${groupOn ? " pm-btn-toggle-on" : ""}`,
      text: "By project",
      attr: {
        "aria-label": groupOn ? "Stop grouping by project" : "Group the cards by project (the way is set in settings)",
        "aria-pressed": String(groupOn),
      },
    });
    setIcon(groupBtn.createSpan({ cls: "pm-btn-icon" }), "rows-3");
    groupBtn.prepend(groupBtn.lastChild as Node);
    groupBtn.addEventListener("click", () => void this.plugin.toggleGroupByProject());
    renderFullscreenButton(actions, this.plugin.settings.boardFullscreen, () => void this.plugin.toggleBoardFullscreen());
    renderMoreMenu(actions, this.plugin.ext, { where: "kanban", ws: this.currentWorkspace });

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
        void this.plugin.openProjectDashboard();
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
