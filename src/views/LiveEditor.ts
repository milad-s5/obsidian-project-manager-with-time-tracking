// ╔══════════════════════════════════════════════════════════════════════╗
// ║  LiveEditor — Obsidian's own markdown editor, embedded in a dialog.  ║
// ║  Obsidian has no public API for this. The editor class is borrowed   ║
// ║  from a markdown embed, the way the Kanban plugin does it, so        ║
// ║  everything here is guarded: if a future Obsidian changes the        ║
// ║  internals, createLiveEditor returns null and the caller falls back  ║
// ║  to a plain textarea instead of breaking the dialog.                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { App, MarkdownFileInfo, TFile } from "obsidian";
import { placeholder } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export interface LiveEditor {
  focus: () => void;
  destroy: () => void;
}

export interface LiveEditorOptions {
  value: string;
  /** The note being edited, so links and embeds resolve from it */
  file: TFile | null;
  placeholder?: string;
  onChange: (value: string) => void;
}

/** The parts of Obsidian's internal editor this file touches */
interface InternalEditor {
  owner: { editMode: unknown; editor: unknown; file: TFile | null };
  editor: { cm: EditorView; focus: () => void };
  editorEl?: HTMLElement;
  _loaded?: boolean;
  set(value: string, clear: boolean): void;
  onUpdate(update: ViewUpdate, changed: boolean): void;
  buildLocalExtensions(): Extension[];
  unload(): void;
  destroy?(): void;
}

type InternalEditorClass = new (app: App, parent: HTMLElement, owner: object) => InternalEditor;

interface InternalEmbed {
  editable: boolean;
  editMode: object;
  showEditor(): void;
  unload(): void;
}

interface AppWithEmbeds {
  embedRegistry: {
    embedByExtension: {
      md: (ctx: { app: App; containerEl: HTMLElement }, file: TFile | null, subpath: string) => InternalEmbed;
    };
  };
}

let editorClass: InternalEditorClass | null = null;

/** Builds a throwaway embed once and keeps the editor class it is made of */
function resolveEditorClass(app: App): InternalEditorClass {
  if (editorClass) return editorClass;
  const embed = (app as unknown as AppWithEmbeds).embedRegistry.embedByExtension.md(
    { app, containerEl: createDiv() },
    null,
    ""
  );
  embed.editable = true;
  embed.showEditor();
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(embed.editMode));
  embed.unload();
  editorClass = (proto as { constructor: InternalEditorClass }).constructor;
  return editorClass;
}

export function createLiveEditor(app: App, parent: HTMLElement, o: LiveEditorOptions): LiveEditor | null {
  try {
    const Base = resolveEditorClass(app);

    class Embedded extends Base {
      constructor() {
        super(app, parent, {
          app,
          onMarkdownScroll: () => {},
          getMode: () => "source",
        });
        this.owner.editMode = this;
        this.owner.editor = this.editor;
        this.owner.file = o.file;
        this.set(o.value, false);
        // Commands such as "toggle checkbox" act on the focused editor
        this.editor.cm.contentDOM.addEventListener("focusin", () => {
          app.workspace.activeEditor = this.owner as unknown as MarkdownFileInfo;
        });
      }

      onUpdate(update: ViewUpdate, changed: boolean): void {
        super.onUpdate(update, changed);
        if (changed) o.onChange(this.editor.cm.state.doc.toString());
      }

      buildLocalExtensions(): Extension[] {
        const ext: Extension[] = super.buildLocalExtensions();
        if (o.placeholder) ext.push(placeholder(o.placeholder));
        return ext;
      }
    }

    const editor = new Embedded();
    editor.editorEl?.addClass("pm-live-editor");
    return {
      focus: () => editor.editor.focus(),
      destroy: () => {
        const owner = editor.owner as unknown as MarkdownFileInfo;
        if (app.workspace.activeEditor === owner) app.workspace.activeEditor = null;
        if (editor._loaded) editor.unload();
        editor.destroy?.();
      },
    };
  } catch (err) {
    console.warn("Project Manager: live editor unavailable, using a plain text box", err);
    return null;
  }
}
