import { Plugin, WorkspaceLeaf, TFile, Notice, addIcon } from "obsidian";
import { ProjectManagerSettings, DEFAULT_SETTINGS, Workspace } from "./types";
import { ProjectManagerSettingTab } from "./settings";
import { WorkspaceManager } from "./managers/WorkspaceManager";
import { ProjectManager } from "./managers/ProjectManager";
import { TaskManager } from "./managers/TaskManager";
import { TimeTracker } from "./managers/TimeTracker";
import { KanbanView, KANBAN_VIEW_TYPE } from "./views/KanbanView";
import { ProjectDashboardView, PROJECT_DASHBOARD_VIEW_TYPE } from "./views/ProjectDashboardView";
import { TaskModal } from "./views/TaskModal";
import { ProjectModal } from "./views/ProjectModal";
import { AnalyticsManager } from "./managers/AnalyticsManager";
import { ArchiveManager } from "./managers/ArchiveManager";
import { ProjectManagerApi, createApi } from "./api";
import { Calendar, createCalendar } from "./utils/Calendar";
import { defaultArchiveFolder } from "./utils/WorkspacePaths";
import { NoteScanner } from "./utils/NoteContent";
import { resetTimerWithConfirm } from "./views/TimerBar";

export default class ProjectManagerPlugin extends Plugin {
  settings: ProjectManagerSettings;
  workspaceManager: WorkspaceManager;
  projectManager: ProjectManager;
  taskManager: TaskManager;
  timeTracker: TimeTracker;
  analytics: AnalyticsManager;
  noteScanner: NoteScanner;
  archiveManager: ArchiveManager;
  /** Public surface for other plugins — see src/api.ts */
  api: ProjectManagerApi;
  /** Jalali or Gregorian, per settings. Rebuilt whenever those change. */
  calendar: Calendar;
  /** Raw timer from data.json — held until timeTracker has been constructed */
  private persistedTimer: unknown = null;
  /** Shows only "active" status items — lives on the plugin, not a view, so
   *  toggling it in either board is reflected in the other. */
  focusMode = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.workspaceManager = new WorkspaceManager(this.app);
    this.projectManager = new ProjectManager(this.app);
    this.taskManager = new TaskManager(this.app);
    this.timeTracker = new TimeTracker(this.app, this.taskManager);
    this.timeTracker.setPersistHandler(() => void this.savePluginData());
    this.analytics = new AnalyticsManager(this.app);
    this.noteScanner = new NoteScanner(this.app);
    this.archiveManager = new ArchiveManager(this.app, this.workspaceManager);
    this.api = createApi(this);
    this.rebuildCalendar();

    this.restoreTimer();
    await this.migrateStatusNames();

    // Ensure all workspace folders exist
    for (const ws of this.settings.workspaces) {
      await this.workspaceManager.ensureWorkspace(ws);
      await this.archiveManager.ensureArchiveFolders(ws);
    }

    // Register views
    this.registerView(KANBAN_VIEW_TYPE, (leaf) => new KanbanView(leaf, this));
    this.registerView(PROJECT_DASHBOARD_VIEW_TYPE, (leaf) => new ProjectDashboardView(leaf, this));


    // Commands
    this.addCommand({
      id: "open-kanban",
      name: "Open Kanban Board",
      callback: () => this.openKanban(),
    });

    this.addCommand({
      id: "new-task",
      name: "New Task",
      callback: () => this.openNewTaskModal(this.getCurrentWorkspace()),
    });

    this.addCommand({
      id: "new-project",
      name: "New Project",
      callback: () => this.openNewProjectModal(this.getCurrentWorkspace()),
    });

    this.addCommand({
      id: "sync-archive",
      name: "Tidy archive (move closed items, restore reopened ones)",
      callback: async () => {
        const ws = this.getCurrentWorkspace();
        const r = await this.archiveManager.syncWorkspace(ws);
        new Notice(
          r.moved || r.restored
            ? `Archive tidied — ${r.moved} moved, ${r.restored} restored`
            : "Archive already up to date"
        );
        this.refreshTimerViews();
      },
    });

    this.addCommand({
      id: "open-project-dashboard",
      name: "Open Project Dashboard",
      callback: () => this.openProjectDashboard(),
    });

    this.addCommand({
      id: "toggle-focus-mode",
      name: "Toggle Focus Mode (active items only)",
      callback: () => this.toggleFocusMode(),
    });

    this.addCommand({
      id: "start-timer",
      name: "Start Timer (active file)",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new Notice("No active file"); return; }
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm?.type !== "task") { new Notice("Active file is not a task"); return; }
        try {
          this.timeTracker.startTimer(file.path, fm.title ?? file.basename, fm.workspace ?? this.settings.defaultWorkspaceId);
          new Notice(`Timer started: ${fm.title}`);
          this.refreshTimerViews();
        } catch (err: any) {
          new Notice(err.message);
        }
      },
    });

    this.addCommand({
      id: "pause-timer",
      name: "Pause / Resume Timer",
      callback: () => {
        if (!this.timeTracker.isRunning()) { new Notice("No timer running"); return; }
        this.timeTracker.togglePause();
        new Notice(
          this.timeTracker.isPaused()
            ? `Paused at ${this.timeTracker.getElapsed()}`
            : `Resumed: ${this.timeTracker.getActiveTimer()?.taskTitle}`
        );
        this.refreshTimerViews();
      },
    });

    this.addCommand({
      id: "stop-timer",
      name: "Stop Timer",
      callback: async () => {
        if (!this.timeTracker.isRunning()) { new Notice("No timer running"); return; }
        const ws = this.getCurrentWorkspace();
        const hours = await this.timeTracker.stopTimer(ws);
        new Notice(`Stopped. Logged ${hours}h`);
        this.refreshTimerViews();
      },
    });

    this.addCommand({
      id: "reset-timer",
      name: "Reset Timer (keep running from zero)",
      callback: () => {
        if (!this.timeTracker.isRunning()) { new Notice("No timer running"); return; }
        resetTimerWithConfirm(this.app, this, () => this.refreshTimerViews());
      },
    });

    this.addCommand({
      id: "discard-timer",
      name: "Discard Timer (log nothing)",
      callback: () => {
        if (!this.timeTracker.isRunning()) { new Notice("No timer running"); return; }
        const title = this.timeTracker.getActiveTimer()?.taskTitle;
        this.timeTracker.discard();
        new Notice(`Discarded timer: ${title}`);
        this.refreshTimerViews();
      },
    });

    // Ribbon icons for quick access
    this.addRibbonIcon("folder-open", "Open Kanban Board", () => this.openKanban());
    this.addRibbonIcon("folder-open", "Open Project Dashboard", () => this.openProjectDashboard());

    // Settings tab
    this.addSettingTab(new ProjectManagerSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    // Nothing to tear down here. Leaves are deliberately left alone — Obsidian's
    // guidelines are explicit that detaching them on unload throws away the
    // user's layout — and styles.css is Obsidian's to load and unload.
  }

  /**
   * data.json holds both the settings and the active timer. Settings stay
   * top-level as before, so existing files work without migration, and the timer
   * sits beside them under the activeTimer key.
   */
  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
    const { activeTimer, ...settings } = data;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    this.persistedTimer = activeTimer ?? null;

    // New installs default to Gregorian, which suits most people. But everything
    // that existed before this setting was Jalali-only, so an existing vault
    // keeps Jalali rather than silently switching calendars under the user.
    const isUpgrade = Object.keys(settings).length > 0;
    if (isUpgrade && settings.calendar === undefined) {
      this.settings.calendar = "jalali";
    }

    // Workspaces created before archiving existed do not carry this key
    for (const ws of this.settings.workspaces) {
      if (!ws.archiveFolder) ws.archiveFolder = defaultArchiveFolder(ws.rootFolder);
    }
  }

  /** The only writer of data.json — settings and timer always go out together */
  async savePluginData(): Promise<void> {
    await this.saveData({ ...this.settings, activeTimer: this.timeTracker.serialize() });
  }

  async saveSettings(): Promise<void> {
    // The calendar is derived from settings, so it has to be rebuilt before any
    // view re-reads it — otherwise switching calendars appears to do nothing
    // until the next reload.
    this.rebuildCalendar();
    await this.savePluginData();
  }

  /** One calendar object shared by every view, so they cannot disagree */
  rebuildCalendar(): void {
    this.calendar = createCalendar(this.settings.calendar, this.settings.weekStart);
  }

  /**
   * Renames the old status names in settings, once and for good.
   *
   * Needed because stored settings land on top of DEFAULT_SETTINGS: without it,
   * data.json keeps "not started" forever and the board columns stop matching the
   * migrated notes — meaning no task is drawn at all. The old name is *replaced*
   * here, not supported alongside.
   */
  private async migrateStatusNames(): Promise<void> {
    const RENAMES: Record<string, string> = {
      "not started": "todo",
      "in progress": "active",
    };
    const before = this.settings.statuses.join("\u0000");
    const renamed = this.settings.statuses.map((s) => {
      const key = String(s).trim().toLowerCase();
      return RENAMES[key] ?? key;
    });
    this.settings.statuses = [...new Set(renamed)];
    if (this.settings.statuses.join("\u0000") !== before) {
      await this.savePluginData();
    }
  }

  /** Restores the saved timer and tells the user how long it thinks it has run */
  private restoreTimer(): void {
    if (!this.timeTracker.restore(this.persistedTimer)) return;
    const t = this.timeTracker.getActiveTimer();
    if (!t) return;
    const state = this.timeTracker.isPaused() ? "paused" : "still running";
    new Notice(
      `Timer restored (${state}): ${t.taskTitle} — ${this.timeTracker.getElapsed()}`,
      8000
    );
  }

  getCurrentWorkspace(): Workspace {
    return (
      this.settings.workspaces.find((ws) => ws.id === this.settings.defaultWorkspaceId) ??
      this.settings.workspaces[0]
    );
  }

  async openKanban(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: KANBAN_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshKanban(): void {
    const leaves = this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as KanbanView;
      // Kept in step with the one workspace both boards agree on, not just
      // whichever one this leaf last had picked.
      view.currentWorkspace = this.getCurrentWorkspace();
      view.render();
    }
  }

  openTaskModal(file: TFile, ws: Workspace): void {
    new TaskModal(this.app, this, ws, file).open();
  }

  openNewTaskModal(ws: Workspace): void {
    new TaskModal(this.app, this, ws, null).open();
  }

  openProjectModal(file: TFile, ws: Workspace): void {
    new ProjectModal(this.app, this, ws, file).open();
  }

  openNewProjectModal(ws: Workspace): void {
    new ProjectModal(this.app, this, ws, null).open();
  }

  openProjectDashboard(): void {
    const existing = this.app.workspace.getLeavesOfType(PROJECT_DASHBOARD_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    void leaf.setViewState({ type: PROJECT_DASHBOARD_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Called after any status change: moves the file — and for a project its tasks
   * and their time entries — into the archive, or back out of it.
   *
   * Obsidian's metadata cache updates a beat after frontmatter is written, so we
   * wait to read the new status rather than the old one.
   */
  async syncArchiveFor(ws: Workspace, file: TFile): Promise<void> {
    await this.nextMetadataTick(file);
    const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
    if (type === "project") await this.archiveManager.syncProject(ws, file);
    else if (type === "task") await this.archiveManager.syncTask(ws, file);
  }

  /**
   * Waits for this file's metadata cache to catch up after a write.
   *
   * The event almost always lands within a few milliseconds, so the timeout is
   * only there so a missed event cannot hang the save. It used to be 400ms,
   * which on a slower vault expired first and let the caller read the values
   * that were there before the write.
   */
  private nextMetadataTick(file: TFile): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.app.metadataCache.offref(ref);
        resolve();
      };
      const ref = this.app.metadataCache.on("changed", (changed) => {
        if (changed.path === file.path) finish();
      });
      window.setTimeout(finish, 2000);
    });
  }

  /** After any timer state change both views need refreshing, not just the kanban */
  refreshTimerViews(): void {
    this.refreshKanban();
    this.refreshProjectDashboard();
  }

  /** Reuses refreshTimerViews' "redraw both boards" behaviour so the toggle in
   *  one is instantly reflected in the other, whichever is open. */
  toggleFocusMode(): void {
    this.focusMode = !this.focusMode;
    this.refreshTimerViews();
  }

  refreshProjectDashboard(): void {
    const leaves = this.app.workspace.getLeavesOfType(PROJECT_DASHBOARD_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as ProjectDashboardView;
      view.currentWorkspace = this.getCurrentWorkspace();
      view.render();
    }
  }

  /** The one workspace both boards agree on — switching it in either refreshes both. */
  async setCurrentWorkspace(ws: Workspace): Promise<void> {
    this.settings.defaultWorkspaceId = ws.id;
    await this.saveSettings();
    this.refreshTimerViews();
  }

}
