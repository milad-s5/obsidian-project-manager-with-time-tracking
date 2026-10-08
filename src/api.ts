import { TFile } from "obsidian";
import type ProjectManagerPlugin from "./main";
import { Workspace } from "./types";
import { slugify } from "./utils/FrontmatterUtils";
import { isUnderAnyFolder, matchProject, projectFolders, taskFolders } from "./utils/WorkspacePaths";

/**
 * The plugin's public surface for other plugins.
 *
 * Reached from outside like this:
 *   app.plugins.plugins["project-manager-with-time-tracking"]?.api
 *
 * version is here on purpose so a consumer can tell up front that it is facing
 * an old build, rather than blowing up midway through.
 */
export const PM_API_VERSION = 1;

export interface PmWorkspaceInfo {
  id: string;
  name: string;
}

export interface PmProjectInfo {
  slug: string;
  title: string;
  status: string;
  path: string;
}

export interface PmFileRef {
  slug: string;
  path: string;
}

export interface PmCreateProjectInput {
  title: string;
  status?: string;
  priority?: string;
  due?: string;
}

export interface PmCreateTaskInput {
  title: string;
  projectSlug: string;
  status?: string;
  priority?: string;
  due?: string;
  /** Extra frontmatter fields — for tracking an external source */
  extra?: Record<string, string | number>;
}

export interface ProjectManagerApi {
  version: number;
  listWorkspaces(): PmWorkspaceInfo[];
  listProjects(workspaceId: string): PmProjectInfo[];
  ensureProject(workspaceId: string, input: PmCreateProjectInput): Promise<PmFileRef>;
  createTask(workspaceId: string, input: PmCreateTaskInput): Promise<PmFileRef>;
  findTaskBy(workspaceId: string, key: string, value: string): PmFileRef | null;
}

export function createApi(plugin: ProjectManagerPlugin): ProjectManagerApi {
  const workspaceOrThrow = (id: string): Workspace => {
    const ws = plugin.settings.workspaces.find((w) => w.id === id);
    if (!ws) throw new Error(`Unknown Project Manager workspace: ${id}`);
    return ws;
  };

  const ref = (file: TFile): PmFileRef => ({ slug: file.basename, path: file.path });

  return {
    version: PM_API_VERSION,

    listWorkspaces() {
      return plugin.settings.workspaces.map((ws) => ({ id: ws.id, name: ws.name }));
    },

    listProjects(workspaceId) {
      const ws = workspaceOrThrow(workspaceId);
      const folders = projectFolders(ws);
      const out: PmProjectInfo[] = [];
      for (const file of plugin.app.vault.getMarkdownFiles()) {
        if (!isUnderAnyFolder(file.path, folders)) continue;
        const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm?.type !== "project") continue;
        out.push({
          slug: file.basename,
          title: String(fm.title ?? file.basename),
          status: String(fm.status ?? ""),
          path: file.path,
        });
      }
      return out;
    },

    async ensureProject(workspaceId, input) {
      const ws = workspaceOrThrow(workspaceId);
      // By title first: a project's file name can carry a -2 when its title
      // clashed with another note, so the slug alone would miss it
      const slug = slugify(input.title);
      const projects = this.listProjects(workspaceId);
      const existing = matchProject(input.title, projects) ?? projects.find((p) => p.slug === slug);
      if (existing) return { slug: existing.slug, path: existing.path };

      const file = await plugin.projectManager.createProject(
        ws,
        input.title,
        input.status ?? "todo",
        input.priority ?? "medium",
        input.due ?? ""
      );
      return ref(file);
    },

    async createTask(workspaceId, input) {
      const ws = workspaceOrThrow(workspaceId);
      const file = await plugin.taskManager.createTask(
        ws,
        input.title,
        input.projectSlug,
        input.status ?? "todo",
        input.priority ?? "medium",
        input.due ?? "",
        input.extra
      );
      return ref(file);
    },

    findTaskBy(workspaceId, key, value) {
      const ws = workspaceOrThrow(workspaceId);
      const folders = taskFolders(ws);
      for (const file of plugin.app.vault.getMarkdownFiles()) {
        if (!isUnderAnyFolder(file.path, folders)) continue;
        const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm?.type !== "task") continue;
        if (String(fm[key] ?? "") === value) return ref(file);
      }
      return null;
    },
  };
}
