import { App, TFile } from "obsidian";
import { todayString } from "./DateUtils";
import { DONE_STATUS, normalizeStatus } from "./StatusColors";

/**
 * The `end` to write along with a new status: the day it was moved to done,
 * kept while it stays done, and emptied again when it is reopened. Written
 * in the same save as the status, so the note is not written twice.
 */
export function endDateFields(fm: Record<string, unknown> | undefined, status: string): { end?: string } {
  const wasDone = normalizeStatus(fm?.status) === DONE_STATUS;
  if (normalizeStatus(status) === DONE_STATUS) {
    return wasDone && /^\d{4}-\d{2}-\d{2}/.test(String(fm?.end ?? "")) ? {} : { end: todayString() };
  }
  return wasDone ? { end: "" } : {};
}

export async function updateFrontmatterFields(
  app: App,
  file: TFile,
  fields: Record<string, unknown>
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [k, v] of Object.entries(fields)) {
      fm[k] = v;
    }
  });
}

/**
 * Renames the note's own H1 when its title changes, so the note does not go on
 * saying the old name while every board shows the new one.
 *
 * Only a line that is exactly the old heading is touched. Anything the user
 * wrote is left alone, and a note whose heading was already edited by hand is
 * simply not matched rather than being overwritten.
 */
export async function renameHeading(
  app: App,
  file: TFile,
  from: string,
  to: string
): Promise<void> {
  const before = from.trim();
  const after = to.trim();
  if (!before || !after || before === after) return;

  // One "#" followed by whitespace, so "## Old name" is left alone, and the
  // spacing around the text is ignored — a heading someone reformatted by hand
  // is still the same heading.
  const isTheHeading = (line: string): boolean => {
    const m = line.match(/^#\s+(.*)$/);
    return !!m && m[1].trim() === before;
  };

  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (isTheHeading(lines[i])) {
        lines[i] = `# ${after}`;
        break;
      }
    }
    return lines.join("\n");
  });
}

/**
 * The note a `[[wikilink]]` frontmatter value points at, as a bare slug.
 *
 * Stripping the brackets is not enough. When archiving moves a file, Obsidian
 * rewrites links to it — that is the whole reason moves go through
 * fileManager.renameFile — and a link that has become ambiguous is rewritten as
 * a full vault path. So `[[backup]]` becomes
 * `[[ProjectManager/Work/Archive/Tasks/backup]]`, and every comparison against
 * `[[backup]]` silently stops matching: a task drops out of its project, the
 * project's hours fall to zero, and the board shows a path where a name should be.
 *
 * Aliases and heading anchors are dropped for the same reason — the target is
 * what matters, not how a link happens to be written.
 */
export function linkSlug(value: unknown): string {
  let s = String(value ?? "").trim();
  s = s.replace(/^\[\[/, "").replace(/\]\]$/, "");
  s = s.split("|")[0];
  s = s.split("#")[0];
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  return s.replace(/\.md$/i, "").trim();
}

/**
 * Renders a value as a quoted YAML string.
 *
 * Titles used to be injected straight into "...", where a single quote in the
 * title was enough to break the whole frontmatter — hardly unlikely for titles
 * arriving from outside, such as Codecks cards.
 */
export function yamlString(value: string): string {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

/**
 * A file name from a title. Letters, marks and digits of any script are
 * kept: only Latin and Persian/Arabic used to be, so a title such as
 * "Проект" came out empty.
 */
export function slugify(title: string): string {
  return title.toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{M}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
