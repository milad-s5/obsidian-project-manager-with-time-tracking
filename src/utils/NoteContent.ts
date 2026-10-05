// ╔══════════════════════════════════════════════════════════════════════╗
// ║  NoteContent — "does this note hold anything beyond the template?"   ║
// ║  The task/project template is only frontmatter, an H1 title, and     ║
// ║  for a task a Time Log heading with its table. Anything beyond       ║
// ║  that is the user's own note.                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { App, TFile } from "obsidian";

export interface NoteInfo {
  hasNotes: boolean;
  /** First few lines of the note — shown in a tooltip so it need not be opened */
  excerpt: string;
}

const NO_NOTES: NoteInfo = { hasNotes: false, excerpt: "" };
const EXCERPT_LINES = 3;
const EXCERPT_CHARS = 160;

export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

export function readBodyNotes(content: string): NoteInfo {
  const found: string[] = [];
  let seenTitle = false;
  let inTimeLog = false;

  for (const raw of stripFrontmatter(content).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue; // a rule, not content

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const text = heading[2].trim();
      // The Time Log heading and the table under it are part of the template
      if (/^time log$/i.test(text)) { inTimeLog = true; continue; }
      // The first H1 is the note's own title. Deliberately not tied to "first line",
      // because some notes put their jottings above the title.
      if (!seenTitle && heading[1].length === 1) { seenTitle = true; inTimeLog = false; continue; }
      found.push(text);
      if (found.length >= EXCERPT_LINES) break;
      continue;
    }

    if (inTimeLog && line.startsWith("|")) continue;

    found.push(line);
    if (found.length >= EXCERPT_LINES) break;
  }

  if (!found.length) return NO_NOTES;

  let excerpt = found.join(" · ").replace(/\s+/g, " ").trim();
  if (excerpt.length > EXCERPT_CHARS) excerpt = `${excerpt.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
  return { hasNotes: true, excerpt };
}

/**
 * Where the note a dialog edits lives: the lines after the H1 title, up to the
 * Time Log heading or the end of the file. That is where notes get written by
 * hand anyway, so whatever is already there shows up in the dialog, and the
 * frontmatter, title and time table are never part of what gets rewritten.
 */
function noteRegion(lines: string[]): { start: number; end: number } {
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close !== -1) start = close + 1;
  }
  const title = lines.findIndex((l, i) => i >= start && /^#\s+/.test(l));
  if (title !== -1) start = title + 1;

  let end = lines.findIndex((l, i) => i >= start && /^#{1,6}\s+time log\s*$/i.test(l.trim()));
  if (end === -1) end = lines.length;
  return { start, end };
}

/** Blank lines at either edge are spacing around the note, not part of it */
function trimBlankLines(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

export function readNoteSection(content: string): string {
  const lines = content.split(/\r?\n/);
  const { start, end } = noteRegion(lines);
  return trimBlankLines(lines.slice(start, end)).join("\n");
}

/** Replaces only the note region, keeping the file's own line endings */
export function writeNoteSection(content: string, notes: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const { start, end } = noteRegion(lines);

  const head = trimBlankLines(lines.slice(0, start));
  const tail = trimBlankLines(lines.slice(end));
  const body = trimBlankLines(notes.split(/\r?\n/));

  const out = [...head];
  for (const part of [body, tail]) {
    if (!part.length) continue;
    if (out.length) out.push("");
    out.push(...part);
  }
  return out.join(eol) + eol;
}

/** Reading a file is expensive, so results are cached on mtime */
export class NoteScanner {
  private cache = new Map<string, { mtime: number; info: NoteInfo }>();

  constructor(private app: App) {}

  async info(file: TFile): Promise<NoteInfo> {
    const hit = this.cache.get(file.path);
    if (hit && hit.mtime === file.stat.mtime) return hit.info;

    let info = NO_NOTES;
    try {
      info = readBodyNotes(await this.app.vault.cachedRead(file));
    } catch {
      // File deleted or locked — a missing marker beats a broken render
    }
    this.cache.set(file.path, { mtime: file.stat.mtime, info });
    return info;
  }

  /** Only files that actually carry notes come back */
  async scan(files: TFile[]): Promise<Map<string, NoteInfo>> {
    const out = new Map<string, NoteInfo>();
    for (const file of files) {
      const info = await this.info(file);
      if (info.hasNotes) out.set(file.path, info);
    }
    return out;
  }
}

/** Card marker — one fixed spot, so a column can be scanned at a glance */
export function renderNoteBadge(parent: HTMLElement, info: NoteInfo): HTMLElement {
  const badge = parent.createSpan({ cls: "pm-note-badge", text: "📝" });
  badge.setAttribute("title", info.excerpt);
  badge.setAttribute("aria-label", `Has notes: ${info.excerpt}`);
  return badge;
}
