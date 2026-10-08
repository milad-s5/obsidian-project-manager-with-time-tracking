import { App, TFile } from "obsidian";
import { Workspace } from "../types";
import { linkSlug } from "../utils/FrontmatterUtils";
import { ProjectManager } from "./ProjectManager";

/**
 * Keeps each project note's hours and task_count in step with its tasks.
 *
 * Those two fields were written once, as zeros, when a project was created
 * and never touched again, so anything reading them (Dataview, Bases, a
 * search) saw every project at 0 hours and 0 tasks.
 *
 * It watches task notes rather than hooking every place a task can change,
 * so a timer, a dialog, a drag, the API and an edit by hand all count the
 * same. A task that moves to another project updates both projects.
 */
export class ProjectStatsSync {
  /** Task path → the project it belonged to when last seen */
  private projectOf = new Map<string, string>();
  /** Workspace id → projects waiting to be recounted */
  private pending = new Map<string, { ws: Workspace; slugs: Set<string> }>();
  private timer: number | null = null;

  constructor(
    private app: App,
    private projects: ProjectManager,
    private workspaceOf: (file: TFile) => Workspace | null,
    private workspaceOfPath: (path: string) => Workspace | null
  ) {}

  /** Learns where every task currently stands, without writing anything */
  seed(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type === "task") this.projectOf.set(file.path, linkSlug(fm.project));
    }
  }

  onChanged(file: TFile): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "task") return;
    const ws = this.workspaceOf(file);
    if (!ws) return;
    const now = linkSlug(fm.project);
    const before = this.projectOf.get(file.path);
    this.projectOf.set(file.path, now);
    this.queue(ws, [now, before]);
  }

  onDeleted(path: string): void {
    const before = this.projectOf.get(path);
    if (before === undefined) return;
    this.projectOf.delete(path);
    const ws = this.workspaceOfPath(path);
    if (ws) this.queue(ws, [before]);
  }

  onRenamed(path: string, oldPath: string): void {
    const before = this.projectOf.get(oldPath);
    if (before === undefined) return;
    this.projectOf.delete(oldPath);
    this.projectOf.set(path, before);
  }

  private queue(ws: Workspace, slugs: (string | undefined)[]): void {
    const entry = this.pending.get(ws.id) ?? { ws, slugs: new Set<string>() };
    for (const s of slugs) if (s) entry.slugs.add(s);
    if (!entry.slugs.size) return;
    this.pending.set(ws.id, entry);
    // A stop or a save is several writes in a row; recount once at the end
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 500);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const { ws, slugs } of batch) {
      for (const slug of slugs) await this.projects.updateProjectStats(this.app, ws, slug);
    }
  }

  cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
