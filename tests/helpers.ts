// Shared setup for the manager tests: an in-memory vault with a workspace's
// folders in place and the managers wired the way main.ts wires them.
import { MockApp, TFile, settle } from "./obsidian";
import { Workspace } from "../src/types";
import { WorkspaceManager } from "../src/managers/WorkspaceManager";
import { TaskManager } from "../src/managers/TaskManager";
import { ProjectManager } from "../src/managers/ProjectManager";
import { TimeTracker } from "../src/managers/TimeTracker";
import { ArchiveManager } from "../src/managers/ArchiveManager";
import { AnalyticsManager } from "../src/managers/AnalyticsManager";

export function workspace(name = "Work", id = "default"): Workspace {
  return {
    id,
    name,
    rootFolder: name,
    projectsFolder: `${name}/Projects`,
    tasksFolder: `${name}/Tasks`,
    timeEntriesFolder: `${name}/TimeEntries`,
    archiveFolder: `${name}/Archive`,
  };
}

export async function setup(opts: { latency?: number; workspaces?: Workspace[] } = {}) {
  const app = new MockApp({ latency: opts.latency });
  const a = app as never;
  const workspaces = opts.workspaces ?? [workspace()];
  const workspaceManager = new WorkspaceManager(a);
  const taskManager = new TaskManager(a);
  const projectManager = new ProjectManager(a);
  const tracker = new TimeTracker(a, taskManager);
  const archive = new ArchiveManager(a, workspaceManager);
  const analytics = new AnalyticsManager(a);
  for (const ws of workspaces) {
    await workspaceManager.ensureWorkspace(ws);
    await archive.ensureArchiveFolders(ws);
  }
  await settle();

  const ws = workspaces[0];
  return {
    app,
    ws,
    workspaces,
    workspaceManager,
    taskManager,
    projectManager,
    tracker,
    archive,
    analytics,
    /** Every time entry file in the vault */
    entries: () => app.vault.getMarkdownFiles().filter((f) => f.path.includes("/TimeEntries/")),
    fm: (f: TFile) => app.metadataCache.getFileCache(f)?.frontmatter ?? {},
    content: (f: TFile) => app.vault.contentOf(f),
    /** Rows of a task's Time Log table */
    logRows: (f: TFile) => app.vault.contentOf(f).split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2} \|/.test(l)),
    /** Pretends the running timer was started this many minutes ago */
    backdate: (minutes: number) => {
      const t = tracker.getActiveTimer();
      if (!t) throw new Error("no timer");
      t.startedAt = new Date(Date.now() - minutes * 60000).toISOString();
      if (t.segmentStart) t.segmentStart = t.startedAt;
    },
    async task(title: string, project = "", status = "active"): Promise<TFile> {
      const f = await taskManager.createTask(ws, title, project, status, "medium", "");
      await settle();
      return f as unknown as TFile;
    },
  };
}

export { settle };
