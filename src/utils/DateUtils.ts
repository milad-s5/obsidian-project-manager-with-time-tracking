export function toISOFileStamp(date: Date): string {
  // e.g. 2026-06-04T12-41-52-595Z
  return date.toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

export function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
