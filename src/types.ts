import { CalendarKind, WeekStart } from "./utils/Calendar";

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
  dateFormat: string;
  statuses: string[];
  priorities: string[];
  /** Which calendar the dashboard counts and labels in */
  calendar: CalendarKind;
  /** Which day a week starts on; "auto" follows the calendar's own custom */
  weekStart: WeekStart;
  /** What Delete does to a note */
  deleteBehaviour: DeleteBehaviour;
}

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
  dateFormat: "YYYY-MM-DD",
  statuses: ["todo", "active", "done", "cancel", "quite"],
  priorities: ["low", "medium", "high", "critical"],
  calendar: "gregorian",
  weekStart: "auto",
  deleteBehaviour: "trash",
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
