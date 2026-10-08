import { setIcon, TFile } from "obsidian";
import { projectColor } from "../utils/StatusColors";
import { formatHours } from "./DashboardCharts";
import type { ProjectOrder } from "../types";

/** The tasks of one project, as the Kanban groups them */
export interface ProjectGroup {
  /** "" for tasks with no project */
  slug: string;
  title: string;
  files: TFile[];
}

/** What a project is ordered by on the grouped board */
export interface ProjectFacts {
  /** "" for tasks with no project */
  slug: string;
  title: string;
  pinned: boolean;
  /** Last time one of its tasks changed, in ms */
  lastActive: number;
  /** Index in the priority list: higher is more urgent */
  priority: number;
  /** Tasks not yet closed */
  open: number;
}

/**
 * The place of each project on the grouped board: pinned ones first, then
 * the tasks with no project, so they are in view to be given one, then the
 * rest, each by the chosen order and then by name. Worked out once for the
 * whole board, so every column puts its groups in the same order.
 */
export function projectRanking(facts: ProjectFacts[], order: ProjectOrder): Map<string, number> {
  const key = (f: ProjectFacts): number =>
    order === "activity" ? -f.lastActive : order === "priority" ? -f.priority : order === "open" ? -f.open : 0;
  const sorted = [...facts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (!a.slug !== !b.slug) return a.slug ? 1 : -1;
    return key(a) - key(b) || a.title.localeCompare(b.title);
  });
  return new Map(sorted.map((f, i) => [f.slug, i]));
}

/** Splits tasks by project, keeping the order they came in within each */
export function groupByProject(
  files: TFile[],
  slugOf: (file: TFile) => string,
  titleOf: (slug: string) => string,
  rank: Map<string, number>
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const file of files) {
    const slug = slugOf(file);
    let group = groups.get(slug);
    if (!group) {
      group = { slug, title: slug ? titleOf(slug) : "No project", files: [] };
      groups.set(slug, group);
    }
    group.files.push(file);
  }
  const at = (g: ProjectGroup) => rank.get(g.slug) ?? Number.MAX_SAFE_INTEGER;
  return [...groups.values()].sort((a, b) => at(a) - at(b) || a.title.localeCompare(b.title));
}

/**
 * A group's heading: fold arrow, the project's colour, name, how many tasks
 * and how many hours. Clicking it folds or opens the group.
 */
export function renderGroupHeading(
  parent: HTMLElement,
  o: {
    group: ProjectGroup; count: number; hours: number; collapsed: boolean; onToggle: (collapsed: boolean) => void;
    /** Shows a pin, for a project rather than the "No project" group */
    pinned?: boolean; onPin?: () => void;
  }
): HTMLElement {
  const head = parent.createDiv({ cls: "pm-group-head", attr: { role: "button", tabindex: "0" } });
  head.setCssProps({ "--pm-project-color": projectColor(o.group.slug) });
  const arrow = head.createSpan({ cls: "pm-group-arrow" });
  head.createSpan({ cls: "pm-group-swatch" });
  head.createSpan({ cls: "pm-group-title", text: o.group.title });
  if (o.onPin) {
    const onPin = o.onPin;
    const pin = head.createSpan({
      cls: `pm-group-pin${o.pinned ? " is-pinned" : ""}`,
      attr: { role: "button", tabindex: "0", "aria-label": o.pinned ? "Unpin" : "Pin to the top", "aria-pressed": String(!!o.pinned) },
    });
    setIcon(pin, "pin");
    const press = (e: Event) => { e.stopPropagation(); e.preventDefault(); onPin(); };
    pin.addEventListener("click", press);
    pin.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") press(e); });
  }
  head.createSpan({ cls: "pm-col-count", text: String(o.count) });
  head.createSpan({ cls: "pm-group-hours", text: formatHours(o.hours) });

  let collapsed = o.collapsed;
  const paint = () => {
    // Folded points along the reading direction, which a right-to-left board mirrors
    const rtl = parent.closest("[dir]")?.getAttribute("dir") === "rtl";
    setIcon(arrow, collapsed ? (rtl ? "chevron-left" : "chevron-right") : "chevron-down");
    head.setAttr("aria-expanded", String(!collapsed));
    head.setAttr("aria-label", `${collapsed ? "Show" : "Hide"} the tasks of ${o.group.title}`);
  };
  const toggle = (e: Event) => {
    e.stopPropagation();
    collapsed = !collapsed;
    paint();
    o.onToggle(collapsed);
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); }
  });
  paint();
  return head;
}
