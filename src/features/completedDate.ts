// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Completed date                                                      ║
// ║  Fills a task's or project's `end` with the day it was moved to      ║
// ║  done, and empties it again if it is reopened. The dashboard reads   ║
// ║  it to show what was finished in a period, time logged or not.       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import type ProjectManagerPlugin from "../main";
import { isDoneStatus } from "../managers/AnalyticsManager";
import { todayISO } from "../utils/Jalali";

const WRITE_DELAY_MS = 800;

export function setupCompletedDate(plugin: ProjectManagerPlugin): void {
  plugin.registerEvent(
    plugin.events.on("status-changed", (change) => {
      // A note seen for the first time while Obsidian indexes is not a change
      if (change.from === null && !change.created) return;
      const done = isDoneStatus(change.to);
      if (!done && (change.from === null || !isDoneStatus(change.from))) return;
      // Moving to done also moves the note to the archive. A write started
      // during the move finds no file, so it waits for the move to be over
      // and then writes only if the note still says what it said
      window.setTimeout(() => {
        const file = change.file;
        if (plugin.app.vault.getAbstractFileByPath(file.path) !== file) return;
        const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm || isDoneStatus(String(fm.status ?? "")) !== done) return;
        // A note copied or synced in already done says itself when it was finished
        if (change.from === null && /^\d{4}-\d{2}-\d{2}/.test(String(fm.end ?? ""))) return;
        const end = done ? todayISO() : "";
        if (String(fm.end ?? "") === end) return;
        void plugin.app.fileManager.processFrontMatter(file, (f) => { f.end = end; }).catch(() => undefined);
      }, WRITE_DELAY_MS);
    })
  );
}
