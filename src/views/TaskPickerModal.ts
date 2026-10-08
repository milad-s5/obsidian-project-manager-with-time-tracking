import { App, SuggestModal, TFile } from "obsidian";
import { linkSlug } from "../utils/FrontmatterUtils";
import { isClosedStatus } from "../utils/StatusColors";

/** A task to put time on, or a new one by the name typed */
export type TaskChoice = { file: TFile; title: string; meta: string } | { create: string };

/**
 * Asks which task some time was for: the workspace's unfinished tasks,
 * most recently changed first, found by typing part of a title. What is
 * typed can also become a new task.
 */
export class TaskPickerModal extends SuggestModal<TaskChoice> {
  private picked = false;

  constructor(
    app: App,
    private tasks: TFile[],
    private projectTitle: (slug: string) => string,
    private onChoose: (choice: TaskChoice) => void | Promise<void>,
    private onCancel: () => void = () => {}
  ) {
    super(app);
    this.setPlaceholder("Which task was this time for? Type to find one, or a new title");
    this.setInstructions([
      { command: "↑↓", purpose: "to move" },
      { command: "↵", purpose: "to log the time on it" },
      { command: "esc", purpose: "to keep the timer running" },
    ]);
  }

  getSuggestions(query: string): TaskChoice[] {
    const q = query.trim().toLowerCase();
    const open: { file: TFile; title: string; meta: string }[] = [];
    for (const file of this.tasks) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || isClosedStatus(fm.status)) continue;
      const slug = linkSlug(fm.project);
      open.push({
        file,
        title: String(fm.title ?? file.basename),
        meta: [slug ? this.projectTitle(slug) : "No project", String(fm.status ?? "")].filter(Boolean).join(" · "),
      });
    }
    open.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
    const found = q
      ? [
          ...open.filter((t) => t.title.toLowerCase().startsWith(q)),
          ...open.filter((t) => !t.title.toLowerCase().startsWith(q) && t.title.toLowerCase().includes(q)),
        ]
      : open;
    const exact = found.some((t) => t.title.trim().toLowerCase() === q);
    return q && !exact ? [...found, { create: query.trim() }] : found;
  }

  renderSuggestion(choice: TaskChoice, el: HTMLElement): void {
    el.addClass("pm-task-pick");
    if ("create" in choice) {
      el.createDiv({ cls: "pm-task-pick-title", text: `+ New task “${choice.create}”` });
      el.createDiv({ cls: "pm-task-pick-meta", text: "Created as active, with the time on it" });
      return;
    }
    el.createDiv({ cls: "pm-task-pick-title", text: choice.title });
    el.createDiv({ cls: "pm-task-pick-meta", text: choice.meta });
  }

  onChooseSuggestion(choice: TaskChoice): void {
    this.picked = true;
    void this.onChoose(choice);
  }

  onClose(): void {
    super.onClose();
    // onChooseSuggestion runs after onClose, so a pick is waited for a beat
    window.setTimeout(() => { if (!this.picked) this.onCancel(); }, 0);
  }
}
