import { setIcon } from "obsidian";
import { statusColor } from "../utils/StatusColors";

/** Which board a column belongs to — each remembers its folded columns apart */
export type BoardKind = "tasks" | "projects";

export interface BoardColumnOptions {
  status: string;
  count: number;
  collapsed: boolean;
  /** Stores the new state; the column has already been redrawn by then */
  onToggle: (collapsed: boolean) => void;
  /** A card's file path was dropped on this column */
  onDrop: (path: string) => Promise<void>;
  /** Adds a header "+" that creates a new item in this column's status */
  onAdd?: () => void;
  /** Names the item for the "+" button's label — "task", "project" */
  addLabel?: string;
}

export interface BoardColumn {
  col: HTMLElement;
  /** Filled by the caller */
  cards: HTMLElement;
}

/**
 * One status column, shared by the Kanban and the projects board: strip,
 * header with count and fold arrow, and an empty card list.
 *
 * Folding toggles a class instead of re-rendering, so the width change
 * animates — the column's edge slides in and leaves a narrow bar with the name
 * written down it. The whole column is the drop target rather than the card
 * list, so a folded bar still takes a dragged card.
 */
export function renderBoardColumn(board: HTMLElement, o: BoardColumnOptions): BoardColumn {
  const col = board.createDiv({ cls: "pm-kanban-col" });
  col.setCssProps({ "--pm-status-color": statusColor(o.status) });
  col.toggleClass("is-collapsed", o.collapsed);
  col.createDiv({ cls: "pm-col-strip" });

  const header = col.createDiv({ cls: "pm-col-header" });
  header.createSpan({ cls: "pm-col-title", text: o.status });
  const end = header.createDiv({ cls: "pm-col-header-end" });
  end.createSpan({ cls: "pm-col-count", text: String(o.count) });
  if (o.onAdd) {
    const onAdd = o.onAdd;
    const add = end.createEl("button", {
      cls: "pm-col-add",
      attr: { "aria-label": `New ${o.addLabel ?? "item"} in ${o.status}` },
    });
    setIcon(add, "plus");
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      onAdd();
    });
  }
  const fold = end.createEl("button", { cls: "pm-col-fold" });

  const paint = () => {
    const collapsed = col.hasClass("is-collapsed");
    setIcon(fold, collapsed ? "chevron-right" : "chevron-left");
    fold.setAttr("aria-label", collapsed ? `Expand ${o.status}` : `Collapse ${o.status}`);
    fold.setAttr("aria-expanded", String(!collapsed));
  };
  const toggle = () => {
    const collapsed = !col.hasClass("is-collapsed");
    col.toggleClass("is-collapsed", collapsed);
    paint();
    o.onToggle(collapsed);
  };
  paint();

  fold.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  // A folded column is a thin bar — anywhere on it opens it, not just the arrow
  col.addEventListener("click", () => {
    if (col.hasClass("is-collapsed")) toggle();
  });

  col.addEventListener("dragover", (e) => {
    e.preventDefault();
    col.addClass("pm-drag-over");
  });
  col.addEventListener("dragleave", (e) => {
    // dragleave also fires moving between the column's own children
    if (!col.contains(e.relatedTarget as Node | null)) col.removeClass("pm-drag-over");
  });
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    col.removeClass("pm-drag-over");
    const path = e.dataTransfer?.getData("text/plain");
    if (path) await o.onDrop(path);
  });

  const cards = col.createDiv({ cls: "pm-col-cards" });
  cards.setAttribute("data-status", o.status);
  return { col, cards };
}

/**
 * The full-screen switch both boards carry. It is one setting, so turning
 * it on in the Kanban also fills the window with the Projects board, and
 * it is kept until it is turned off again.
 */
export function renderFullscreenButton(
  parent: HTMLElement,
  on: boolean,
  toggle: () => void
): HTMLElement {
  const btn = parent.createEl("button", {
    cls: `pm-btn pm-btn-secondary pm-fullscreen-btn${on ? " pm-btn-toggle-on" : ""}`,
    attr: {
      "aria-label": on ? "Leave full screen (Esc)" : "Full screen: hide the sidebars and everything else",
      "aria-pressed": String(on),
    },
  });
  setIcon(btn, on ? "minimize-2" : "maximize-2");
  btn.addEventListener("click", toggle);
  return btn;
}
