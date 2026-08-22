import { AbstractInputSuggest, App } from "obsidian";

export interface ProjectOption {
  slug: string;
  title: string;
}

/**
 * Type-ahead for a project field.
 *
 * This replaced a native <datalist>. The browser draws that popup itself, so it
 * ignored the theme entirely and came up white on a dark vault; Obsidian's own
 * suggester is styled by whatever theme is loaded, which is the point.
 */
export class ProjectSuggest extends AbstractInputSuggest<ProjectOption> {
  constructor(
    app: App,
    private readonly input: HTMLInputElement,
    private readonly options: () => ProjectOption[],
    private readonly onPick: (option: ProjectOption) => void
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): ProjectOption[] {
    const q = query.trim().toLowerCase();
    const all = this.options();
    if (!q) return all;
    // Titles that start with the query first — typing "de" should offer
    // "Design system" before "Widget depot".
    const starts = all.filter((p) => p.title.toLowerCase().startsWith(q));
    const contains = all.filter(
      (p) => !p.title.toLowerCase().startsWith(q) && p.title.toLowerCase().includes(q)
    );
    return [...starts, ...contains];
  }

  renderSuggestion(option: ProjectOption, el: HTMLElement): void {
    el.setText(option.title);
  }

  selectSuggestion(option: ProjectOption): void {
    this.setValue(option.title);
    this.input.value = option.title;
    this.onPick(option);
    this.close();
  }
}
