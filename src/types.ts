import { CalendarKind, WeekStart } from "./utils/Calendar";
import { DEFAULT_POMODORO, PomodoroSettings } from "./features/pomodoro";

export interface Workspace {
  id: string;
  name: string;
  rootFolder: string;
  projectsFolder: string;
  tasksFolder: string;
  timeEntriesFolder: string;
  /**
   * Archive root. A task or project whose status closes moves here, together
   * with its time entries, into Tasks/Projects/TimeEntries subfolders. Empty
   * turns archiving off. Older workspaces lack this key and get it filled on load.
   */
  archiveFolder: string;
}

export interface ProjectManagerSettings {
  workspaces: Workspace[];
  defaultWorkspaceId: string;
  statuses: string[];
  priorities: string[];
  /** Which calendar the dashboard counts and labels in */
  calendar: CalendarKind;
  /** Which day a week starts on; "auto" follows the calendar's own custom */
  weekStart: WeekStart;
  /** What Delete does to a note */
  deleteBehaviour: DeleteBehaviour;
  /**
   * Board columns the user folded or unfolded, keyed "<board>:<status>".
   * Only explicit choices are stored; a column with no entry takes its default
   * (backlog folded, everything else open).
   */
  collapsedColumns: Record<string, boolean>;
  /** Statuses that close a task or project; "done" always does */
  closedStatuses: string[];
  /** Boards fill the whole window. One switch for both boards, kept across restarts. */
  boardFullscreen: boolean;
  /** Which way the boards read: columns, cards and toolbar all follow it */
  boardDirection: "ltr" | "rtl";
  /** The task board groups its cards by project; switched from its toolbar */
  groupByProject: boolean;
  /** How it groups: a row per project across the columns, or groups inside each column */
  projectGrouping: ProjectGrouping;
  /** Folded project groups and rows, keyed "<workspace id>:<project slug>" */
  collapsedProjectGroups: string[];
  /** Projects pinned to the top of the grouped board, keyed the same way */
  pinnedProjects: string[];
  /** The order of the other projects on the grouped board */
  projectOrder: ProjectOrder;
  /** Width in pixels of the project names beside the rows */
  laneLabelWidth: number;
  /** See src/features/pomodoro.ts */
  pomodoro: PomodoroSettings;
  /** The version whose changes were last shown; "" before any were */
  lastSeenVersion: string;
  /** Open "What's new" by itself after an update */
  showWhatsNew: boolean;
  /**
   * Set once "backlog" has been offered to this vault. An existing vault gets
   * it added to its statuses on the first load after the update; the flag is
   * what keeps it from coming back after the user deletes it.
   */
  backlogAdded: boolean;
}

export type ProjectGrouping = "lanes" | "columns";
export type ProjectOrder = "activity" | "priority" | "name" | "open";
export const DEFAULT_LANE_LABEL_WIDTH = 170;

/**
 * "trash" hands the file to whatever Obsidian is set to do with deleted files,
 * which is recoverable; "permanent" removes it outright. Defaulting to trash
 * keeps the vault owner's own preference in charge unless they say otherwise.
 */
export type DeleteBehaviour = "trash" | "permanent";

export const DEFAULT_SETTINGS: ProjectManagerSettings = {
  workspaces: [
    {
      id: "default",
      name: "ProjectManager",
      rootFolder: "ProjectManager",
      projectsFolder: "ProjectManager/Projects",
      tasksFolder: "ProjectManager/Tasks",
      timeEntriesFolder: "ProjectManager/TimeEntries",
      archiveFolder: "ProjectManager/Archive",
    },
  ],
  defaultWorkspaceId: "default",
  statuses: ["backlog", "todo", "active", "done", "cancel", "quite"],
  priorities: ["low", "medium", "high", "critical"],
  calendar: "gregorian",
  weekStart: "auto",
  deleteBehaviour: "trash",
  collapsedColumns: {},
  closedStatuses: ["done", "cancel", "quite"],
  boardFullscreen: false,
  boardDirection: "ltr",
  groupByProject: false,
  projectGrouping: "lanes",
  collapsedProjectGroups: [],
  pinnedProjects: [],
  projectOrder: "activity",
  laneLabelWidth: DEFAULT_LANE_LABEL_WIDTH,
  pomodoro: { ...DEFAULT_POMODORO },
  lastSeenVersion: "",
  showWhatsNew: true,
  backlogAdded: true,
};

export interface ProjectFrontmatter {
  type: "project";
  title: string;
  status: string;
  priority: string;
  start: string;
  end: string;
  created: string;
  due: string;
  tags: string[];
  hours: number;
  task_count: number;
  workspace: string;
}

export interface TaskFrontmatter {
  type: "task";
  title: string;
  project: string;
  status: string;
  priority: string;
  start: string;
  end: string;
  created: string;
  due: string;
  total_hours: number;
  days_count: number;
  workspace: string;
}

export interface TimeEntry {
  time_entry: string;
  task: string;
  hours: number;
  start_time: string;
  end_time: string;
  created: string;
}

/**
 * The active timer. Everything is serialisable — dates are ISO strings, not Date —
 * because it is stored verbatim in data.json so that a crash or a close brings the
 * timer back exactly where it was.
 *
 * Elapsed time is derived from timestamps rather than an in-memory counter, so
 * there is no need to write to disk every second — only on a state change.
 */
export interface ActiveTimer {
  taskPath: string;
  taskTitle: string;
  workspaceId: string;
  /** ISO — the first start; this is what lands as start_time on the time entry */
  startedAt: string;
  /** ISO — start of the running segment. null means it is paused. */
  segmentStart: string | null;
  /** Milliseconds banked from segments already closed by earlier pauses */
  accumulatedMs: number;
}
