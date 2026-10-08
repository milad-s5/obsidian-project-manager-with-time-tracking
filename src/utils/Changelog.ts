/** One version's part of CHANGELOG.md */
export interface ChangelogSection {
  version: string;
  /** The Markdown under its heading */
  body: string;
}

/** Splits the changelog at its "## x.y.z" headings, newest first; "Unreleased" is left out */
export function changelogSections(markdown: string): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## +(\S+)/);
    if (heading) {
      current = /^\d+(\.\d+)*$/.test(heading[1]) ? { version: heading[1], body: "" } : null;
      if (current) out.push(current);
      continue;
    }
    if (current) current.body += line + "\n";
  }
  for (const s of out) s.body = s.body.trim();
  return out;
}

/** Compares "1.10.0" and "1.9.2" as versions, not as text */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The sections to show after updating from one version to another: every
 * version after the last one seen, up to the one now running. With no last
 * version known, only the one now running.
 */
export function sectionsSince(sections: ChangelogSection[], lastSeen: string, current: string): ChangelogSection[] {
  return sections.filter((s) =>
    compareVersions(s.version, current) <= 0 &&
    (lastSeen ? compareVersions(s.version, lastSeen) > 0 : compareVersions(s.version, current) === 0)
  );
}
