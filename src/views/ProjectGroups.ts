import { setIcon, TFile } from "obsidian";
import { projectColor } from "../utils/StatusColors";
import { formatHours } from "./DashboardCharts";

/** The tasks of one project, as the Kanban groups them */
export interface ProjectGroup {
  /** "" for tasks with no project */
  slug: string;
  title: string;
  files: TFile[];
}

/**
 * Splits tasks by project, keeping the order they came in within each.
 * Projects run in title order; tasks with no project come last.
 */
export function groupByProject(
  files: TFile[],
  slugOf: (file: TFile) => string,
  titleOf: (slug: string) => string
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
  return [...groups.values()].sort((a, b) => {
    if (!a.slug !== !b.slug) return a.slug ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * A group's heading: fold arrow, the project's colour, name, how many tasks
 * and how many hours. Clicking it folds or opens the group.
 */
export function renderGroupHeading(
  parent: HTMLElement,
  o: { group: ProjectGroup; count: number; hours: number; collapsed: boolean; onToggle: (collapsed: boolean) => void }
): HTMLElement {
  const head = parent.createDiv({ cls: "pm-group-head", attr: { role: "button", tabindex: "0" } });
  head.setCssProps({ "--pm-project-color": projectColor(o.group.slug) });
  const arrow = head.createSpan({ cls: "pm-group-arrow" });
  head.createSpan({ cls: "pm-group-swatch" });
  head.createSpan({ cls: "pm-group-title", text: o.group.title });
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
