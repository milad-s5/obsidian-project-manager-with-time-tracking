// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Extensions — the places a feature can plug into                      ║
// ║  Boards, dialogs, the dashboard and settings each call out to these   ║
// ║  lists at fixed points, so a feature lives in its own file under      ║
// ║  src/features and adds itself here, instead of being threaded         ║
// ║  through every view. Removing a feature is then removing its file     ║
// ║  and the one line in main.ts that sets it up.                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { App, EventRef, Events, Menu, TFile } from "obsidian";
import { Workspace } from "../types";
import { linkSlug } from "../utils/FrontmatterUtils";
import { normalizeStatus } from "../utils/StatusColors";
import type { AnalyticsData } from "../managers/AnalyticsManager";

export type BoardKind = "tasks" | "projects";
export type NoteKind = "task" | "project";

/** A card being drawn on either board */
export interface CardContext {
  board: BoardKind;
  file: TFile;
  fm: Record<string, unknown>;
  ws: Workspace;
  card: HTMLElement;
  /** The title row: title, badges, priority dot */
  head: HTMLElement;
  /** The details row: project, due date, hours */
  meta: HTMLElement;
}

/** A status column, after its cards are in */
export interface ColumnContext {
  board: BoardKind;
  ws: Workspace;
  status: string;
  /** How many cards the column holds once the filters are applied */
  count: number;
  col: HTMLElement;
  header: HTMLElement;
  cards: HTMLElement;
}

/** A card's right-click menu, after the built-in items */
export interface CardMenuContext {
  board: BoardKind;
  file: TFile;
  fm: Record<string, unknown>;
  ws: Workspace;
  menu: Menu;
}

/** One extra field in the task or project dialog */
export interface DialogFieldContext {
  kind: NoteKind;
  ws: Workspace;
  /** null while creating */
  file: TFile | null;
  /** The note's frontmatter as the dialog opened; empty while creating */
  fm: Record<string, unknown>;
  container: HTMLElement;
}

export interface DialogField {
  kinds: NoteKind[];
  /**
   * Draws the field. The function it returns is called on save and gives
   * the frontmatter values to write, or a message to stop the save.
   */
  render(ctx: DialogFieldContext): () => Record<string, unknown> | string;
}

/** Everything a dashboard tab or overview card is drawn from */
export interface DashboardContext {
  ws: Workspace;
  data: AnalyticsData;
  /** The period on screen; "to" may lie in the future, "effTo" never does */
  from: string;
  to: string;
  effTo: string;
  periodLabel: string;
  /** Redraws the dashboard */
  refresh: () => void;
  /** The shared tooltip, so a feature's chart behaves like the built-in ones */
  tooltip: unknown;
}

export interface DashboardTab {
  id: string;
  label: () => string;
  render(root: HTMLElement, ctx: DashboardContext): void | Promise<void>;
}

/** An extra card on the Overview tab, after the built-in ones */
export type OverviewCard = (cards: HTMLElement, ctx: DashboardContext) => void;

/** An item in the "⋯" menu of a board's toolbar */
export interface MoreMenuContext {
  where: "kanban" | "dashboard";
  ws: Workspace;
  menu: Menu;
}

export class Extensions {
  cardDecorators: ((ctx: CardContext) => void)[] = [];
  columnDecorators: ((ctx: ColumnContext) => void)[] = [];
  cardMenuItems: ((ctx: CardMenuContext) => void)[] = [];
  dialogFields: DialogField[] = [];
  dashboardTabs: DashboardTab[] = [];
  overviewCards: OverviewCard[] = [];
  moreMenuItems: ((ctx: MoreMenuContext) => void)[] = [];
  settingsSections: ((containerEl: HTMLElement) => void)[] = [];
}

// ── Events ──────────────────────────────────────────────────────────────

export interface StatusChange {
  file: TFile;
  kind: NoteKind;
  ws: Workspace;
  /** null for a note seen for the first time */
  from: string | null;
  to: string;
  /**
   * The note was created moments ago. A note seen for the first time can
   * also be an old one Obsidian is still indexing; features that act on new
   * notes should check this rather than from === null.
   */
  created: boolean;
}

export interface TimeLogged {
  ws: Workspace;
  /** null when the task note could not be found */
  taskFile: TFile | null;
  taskSlug: string;
  hours: number;
  start: Date;
  end: Date;
  /** The time entry note written for it */
  entryFile: TFile | null;
  source: "timer" | "manual";
}

/**
 * The plugin's own events.
 *
 * status-changed fires for any change of a task's or project's status,
 * whoever made it: a drag, a dialog, the timer, the API or an edit by hand.
 * time-logged fires after time is written. timer-changed fires on every
 * start, pause, resume, reset, stop and discard.
 */
export class PmEvents extends Events {
  on(name: "status-changed", callback: (change: StatusChange) => unknown): EventRef;
  on(name: "time-logged", callback: (entry: TimeLogged) => unknown): EventRef;
  on(name: "timer-changed", callback: () => unknown): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef {
    return super.on(name, callback as (...data: unknown[]) => unknown, ctx);
  }
}

/**
 * Turns metadata changes into status-changed events by remembering each
 * task's and project's last status. Watching notes rather than buttons is
 * what makes the event fire for every way a status can change.
 */
export class StatusWatcher {
  private last = new Map<string, string>();

  constructor(
    private app: App,
    private events: PmEvents,
    private workspaceOf: (file: TFile) => Workspace | null
  ) {}

  /** Learns every current status without firing anything */
  seed(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type === "task" || fm?.type === "project") this.last.set(file.path, normalizeStatus(fm.status));
    }
  }

  onChanged(file: TFile): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "task" && fm?.type !== "project") return;
    const to = normalizeStatus(fm.status);
    const from = this.last.has(file.path) ? this.last.get(file.path) ?? null : null;
    this.last.set(file.path, to);
    if (from === to) return;
    const ws = this.workspaceOf(file);
    if (!ws) return;
    const created = from === null && Date.now() - file.stat.ctime < 60_000;
    this.events.trigger("status-changed", { file, kind: fm.type, ws, from, to, created } satisfies StatusChange);
  }

  onRenamed(path: string, oldPath: string): void {
    const s = this.last.get(oldPath);
    if (s === undefined) return;
    this.last.delete(oldPath);
    this.last.set(path, s);
  }

  onDeleted(path: string): void {
    this.last.delete(path);
  }
}

/** A task's project, as the slug its link points at */
export function projectOf(fm: Record<string, unknown> | undefined): string {
  return linkSlug(fm?.project);
}
