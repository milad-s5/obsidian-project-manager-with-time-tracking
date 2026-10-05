// ╔══════════════════════════════════════════════════════════════════════╗
// ║  LiveEditor — Obsidian's own markdown editor, embedded in a dialog.  ║
// ║  Obsidian has no public API for this. The editor class is borrowed   ║
// ║  from a markdown embed, the way the Kanban plugin does it, so        ║
// ║  everything here is guarded: if a future Obsidian changes the        ║
// ║  internals, createLiveEditor returns null and the caller falls back  ║
// ║  to a plain textarea instead of breaking the dialog.                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { App, TFile } from "obsidian";
import { placeholder } from "@codemirror/view";
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

/* eslint-disable @typescript-eslint/no-explicit-any -- internal API, untyped by nature */

let editorClass: any = null;

/** Builds a throwaway embed once and keeps the editor class it is made of */
function resolveEditorClass(app: App): any {
  if (editorClass) return editorClass;
  const embed = (app as any).embedRegistry.embedByExtension.md(
    { app, containerEl: createDiv() },
    null,
    ""
  );
  embed.editable = true;
  embed.showEditor();
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(embed.editMode));
  embed.unload();
  editorClass = proto.constructor;
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
        const self = this as any;
        self.owner.editMode = this;
        self.owner.editor = self.editor;
        self.owner.file = o.file;
        self.set(o.value, false);
        // Commands such as "toggle checkbox" act on the focused editor
        self.editor.cm.contentDOM.addEventListener("focusin", () => {
          (app.workspace as any).activeEditor = self.owner;
        });
      }

      onUpdate(update: any, changed: boolean): void {
        super.onUpdate(update, changed);
        if (changed) o.onChange((this as any).editor.cm.state.doc.toString());
      }

      buildLocalExtensions(): Extension[] {
        const ext: Extension[] = super.buildLocalExtensions();
        if (o.placeholder) ext.push(placeholder(o.placeholder));
        return ext;
      }
    }

    const editor = new Embedded() as any;
    editor.editorEl?.addClass("pm-live-editor");
    return {
      focus: () => editor.editor.focus(),
      destroy: () => {
        if ((app.workspace as any).activeEditor === editor.owner) (app.workspace as any).activeEditor = null;
        if (editor._loaded) editor.unload();
        editor.destroy?.();
      },
    };
  } catch (err) {
    console.warn("Project Manager: live editor unavailable, using a plain text box", err);
    return null;
  }
}
