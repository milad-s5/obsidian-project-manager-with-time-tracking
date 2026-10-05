import { App, Component, MarkdownRenderer, TFile, setIcon } from "obsidian";
import { createLiveEditor, LiveEditor } from "./LiveEditor";

export interface NotesEditorOptions {
  app: App;
  /** The note the text belongs to, so links and embeds resolve from it */
  file: TFile | null;
  value: string;
  onChange: (value: string) => void;
  /** A link in the rendered note was followed */
  onOpenLink?: () => void;
}

export interface NotesEditor {
  /** Releases what the rendered markdown holds on to */
  unload: () => void;
}

const TASK_BOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * The note inside a task or project dialog, so it can be read and written
 * without leaving the board.
 *
 * Read mode is Obsidian's own rendering — links, lists, checkboxes — and
 * clicking the text or the pencil switches to Obsidian's own editor, so
 * writing looks the way the note does (Live Preview), with a plain textarea
 * only as a fallback. An empty note opens straight into writing. Ticking a
 * checkbox in read mode edits the text too, so it is kept by Save like any
 * other change.
 */
export function mountNotesEditor(parent: HTMLElement, o: NotesEditorOptions): NotesEditor {
  const component = new Component();
  component.load();
  let value = o.value;
  let editing = !value.trim();
  let live: LiveEditor | null = null;
  const sourcePath = o.file?.path ?? "";

  const wrap = parent.createDiv({ cls: "pm-notes" });
  const header = wrap.createDiv({ cls: "pm-notes-header" });
  header.createEl("h3", { text: "Notes" });
  const toggle = header.createEl("button", { cls: "pm-notes-toggle" });
  const body = wrap.createDiv({ cls: "pm-notes-body" });

  const set = (v: string) => {
    value = v;
    o.onChange(v);
  };

  const showEdit = () => {
    body.empty();
    live = createLiveEditor(o.app, body, {
      value,
      file: o.file,
      placeholder: "Write a note…",
      onChange: set,
    });
    if (live) {
      const editor = live;
      window.setTimeout(() => editor.focus(), 0);
      return;
    }

    const area = body.createEl("textarea", {
      cls: "pm-notes-input",
      attr: { dir: "auto", placeholder: "Write a note… (Markdown works)", rows: "4" },
    });
    area.value = value;
    // Grows with the text instead of scrolling inside a tiny box
    const fit = () => {
      area.setCssStyles({ height: "auto" });
      area.setCssStyles({ height: `${area.scrollHeight + 2}px` });
    };
    area.addEventListener("input", () => {
      set(area.value);
      fit();
    });
    window.setTimeout(() => {
      fit();
      area.focus();
    }, 0);
  };

  const showRead = async () => {
    body.empty();
    const view = body.createDiv({ cls: "pm-notes-view markdown-rendered", attr: { dir: "auto" } });
    if (!value.trim()) {
      view.createDiv({ cls: "pm-notes-empty", text: "No notes yet — click to write one." });
    } else {
      await MarkdownRenderer.render(o.app, value, view, sourcePath, component);
    }

    view.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a");
      if (link) {
        e.preventDefault();
        const href = link.getAttribute("data-href") ?? link.getAttribute("href") ?? "";
        if (link.hasClass("internal-link")) {
          void o.app.workspace.openLinkText(href, sourcePath, false);
        } else if (href) {
          window.open(href, "_blank");
        }
        o.onOpenLink?.();
        return;
      }
      if (target instanceof HTMLInputElement && target.type === "checkbox") return;
      editing = true;
      paint();
    });

    // The nth rendered checkbox is the nth "- [ ]" in the text
    view.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox").forEach((box, n) => {
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        let seen = -1;
        const lines = value.split("\n").map((line) => {
          if (!TASK_BOX.test(line) || ++seen !== n) return line;
          return line.replace(TASK_BOX, (_m, a, mark, b) => `${a}${mark === " " ? "x" : " "}${b}`);
        });
        set(lines.join("\n"));
        box.closest("li")?.toggleClass("is-checked", box.checked);
      });
    });
  };

  const paint = () => {
    live?.destroy();
    live = null;
    setIcon(toggle, editing ? "eye" : "pencil");
    toggle.setAttr("aria-label", editing ? "Preview note" : "Edit note");
    if (editing) showEdit();
    else void showRead();
  };

  toggle.addEventListener("click", () => {
    editing = !editing;
    paint();
  });
  paint();

  return {
    unload: () => {
      live?.destroy();
      component.unload();
    },
  };
}
