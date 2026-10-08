import { App } from "obsidian";
import { Workspace } from "../types";
import { AnalyticsManager } from "./AnalyticsManager";
import { ProjectManager } from "./ProjectManager";

export interface RebuildResult {
  tasks: number;
  projects: number;
}

/**
 * Recomputes every task's total_hours and days_count, and every project's
 * hours and task_count, from the time actually logged.
 *
 * Those fields are running totals, added to as time is logged. Deleting a
 * time entry by hand, editing a Time Log row, or a sync conflict leaves
 * them disagreeing with the entries, with nothing in the plugin to set them
 * straight. This does, counting each piece of time once whether it lives
 * in a time entry, a Time Log row or both, the way the dashboard does.
 */
export async function rebuildTotals(
  app: App,
  ws: Workspace,
  analytics: AnalyticsManager,
  projects: ProjectManager
): Promise<RebuildResult> {
  const data = await analytics.collect(ws);
  const byTask = new Map<string, { hours: number; days: Set<string> }>();
  for (const rec of data.records) {
    const row = byTask.get(rec.taskSlug) ?? { hours: 0, days: new Set<string>() };
    row.hours += rec.hours;
    if (rec.hours > 0) row.days.add(rec.iso);
    byTask.set(rec.taskSlug, row);
  }

  const result: RebuildResult = { tasks: 0, projects: 0 };
  for (const task of data.tasks) {
    const logged = byTask.get(task.slug);
    const hours = Math.round((logged?.hours ?? 0) * 100) / 100;
    const days = logged?.days.size ?? 0;
    if (task.totalHours === hours && task.daysCount === days) continue;
    await app.fileManager.processFrontMatter(task.file, (fm) => {
      fm.total_hours = hours;
      fm.days_count = days;
    });
    result.tasks++;
  }

  // The project counts read the task totals just written, so they wait for
  // the metadata cache to catch up
  await new Promise((r) => window.setTimeout(r, 300));
  for (const project of data.projects) {
    if (await projects.updateProjectStats(app, ws, project.slug)) result.projects++;
  }
  return result;
}
