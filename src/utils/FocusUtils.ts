export interface CapturedFocus {
  selector: string;
  start: number | null;
  end: number | null;
}

/**
 * A full re-render rebuilds every element, including whichever text filter was
 * mid-typing — so its focus and cursor position have to be captured before the
 * rebuild and put back afterwards, rather than silently dropping the field.
 * Only elements marked with a stable `data-filter` attribute participate.
 */
export function captureFocus(container: HTMLElement): CapturedFocus | null {
  const active = document.activeElement as HTMLInputElement | null;
  if (!active || !container.contains(active)) return null;
  const key = active.getAttribute("data-filter");
  if (!key) return null;
  return { selector: `[data-filter="${key}"]`, start: active.selectionStart, end: active.selectionEnd };
}

export function restoreFocus(container: HTMLElement, captured: CapturedFocus | null): void {
  if (!captured) return;
  const el = container.querySelector<HTMLInputElement>(captured.selector);
  if (!el) return;
  el.focus();
  if (captured.start !== null) el.setSelectionRange(captured.start, captured.end ?? captured.start);
}
