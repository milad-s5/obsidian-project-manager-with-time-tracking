// status and priority colours come from the dashboard's validated palette (the
// --pm-cat-* and --pm-status-* tokens defined in styles/dashboardStyles.ts) rather
// than theme variables. These colours encode *data*: they have to agree between
// the kanban and the charts, and stay distinguishable under colour blindness.
// The tokens themselves carry separate light and dark values, so they follow the theme.

// The slot order is not arbitrary: this sequence (blue, orange, teal, red, purple)
// was checked with validate_palette — the worst neighbouring pair is ΔE 6.9, below
// the threshold, which is only allowed alongside a second encoding — hence the
// legends, labels and 2px gaps everywhere.
const STATUS_SLOT: Record<string, number> = {
  todo: 1,    // blue
  active: 2,  // orange
  done: 3,    // teal
  cancel: 8,  // red
  quite: 7,   // purple
};

/**
 * frontmatter status → canonical name. Lowercase and trim only; there is no
 * mapping from old names, because an old name means unmigrated data, not a synonym.
 */
export function normalizeStatus(status: unknown): string {
  return String(status ?? "").trim().toLowerCase();
}

// The palette's remaining slots serve user-defined statuses — a new colour is never
// invented, one of these eight is chosen.
const FALLBACK_SLOTS = [4, 5, 6];

const PRIORITY_TOKENS: Record<string, string> = {
  low: "var(--pm-status-good)",
  medium: "var(--pm-status-warning)",
  high: "var(--pm-status-serious)",
  critical: "var(--pm-status-critical)",
};

/** Stable hash — so a status does not change colour when others are filtered out */
function stableIndex(key: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % buckets;
}

export function statusSlot(status: string): number {
  const key = normalizeStatus(status);
  return STATUS_SLOT[key] ?? FALLBACK_SLOTS[stableIndex(key, FALLBACK_SLOTS.length)];
}

/** A project's colour on the board, the same every time; grey for no project */
export function projectColor(slug: string): string {
  return slug ? `var(--pm-cat-${1 + stableIndex(slug, 8)})` : "var(--text-faint)";
}

export function statusColor(status: string): string {
  // Backlog is deliberately grey: it is not work in flight, and a palette slot
  // would make it compete with todo and active for attention.
  if (isBacklogStatus(status)) return "var(--pm-status-backlog)";
  return `var(--pm-cat-${statusSlot(status)})`;
}

/**
 * Work that may happen one day but is not committed to. It is open — not
 * closed, not archived — yet stays out of "open tasks", overdue and project
 * progress, which are about what has actually been taken on.
 */
export const BACKLOG_STATUS = "backlog";

export function isBacklogStatus(status: unknown): boolean {
  return normalizeStatus(status) === BACKLOG_STATUS;
}

export function priorityColor(priority: string): string {
  return PRIORITY_TOKENS[(priority ?? "").toLowerCase()] ?? "var(--text-faint)";
}

/** The status that counts as finished, for progress and "done of" counts */
export const DONE_STATUS = "done";

export const DEFAULT_CLOSED_STATUSES = ["done", "cancel", "quite"];

/**
 * Statuses that close a task or project: archived, shown muted, and left
 * out of open work. The set comes from settings, and the archive, the
 * dashboard and both boards all read it from here. It used to be written
 * out separately in three places, none of which followed the status list,
 * so a renamed or added closing status was never treated as closed.
 */
let closedStatuses = new Set(DEFAULT_CLOSED_STATUSES);

export function setClosedStatuses(list: string[]): void {
  // Done always closes, whatever the list says
  closedStatuses = new Set([DONE_STATUS, ...list.map((s) => normalizeStatus(s)).filter(Boolean)]);
}

export function isClosedStatus(status: unknown): boolean {
  return closedStatuses.has(normalizeStatus(status));
}

/** Closed statuses no longer need attention every time — they are shown muted */
export function isMutedStatus(status: string): boolean {
  return isClosedStatus(status);
}
