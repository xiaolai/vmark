/**
 * The pure, React-free core of `usePromptHistory`: match rules, index
 * arithmetic, and the key-event vocabulary its four layers speak.
 *
 * Purpose: the hook is the STATE MACHINE (seven pieces of React state, four
 * key layers); deciding which history rows a draft matches, and where a
 * selection index may land, is a separate concern with no React in it. Split
 * out because the hook sat exactly on the ~300-line cap, and because both
 * rules below were previously written twice — the shape that drifts.
 *
 * PREFIX, not substring (audit #753). Layer 2 (arrow-key cycling) and Layer 3
 * (ghost text) are documented as prefix matching, and ghost text implemented it
 * with `startsWith`; cycling delegated to the store's `getFilteredEntries`,
 * whose parameter is named `prefix` and whose body is `includes`. So a draft of
 * "bar" cycled to "foo bar" — text the user never typed the start of — while
 * the ghost hint for the same draft showed nothing. The store method keeps
 * substring matching, which is right for the searchable dropdown (Layer 4) and
 * is the only thing still using it.
 *
 * @coordinates-with src/hooks/usePromptHistory.ts — the only consumer
 * @coordinates-with src/stores/aiStore/promptHistory.ts — `getFilteredEntries`, the SUBSTRING search behind the dropdown
 * @module services/promptHistory/promptHistoryCore
 */

/** Case-insensitive prefix test — the one definition of "matches the draft". */
export function matchesPrefix(entry: string, prefix: string): boolean {
  return entry.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * History entries that begin with `prefix`, in store order (MRU: index 0 is the
 * most recent). An empty prefix matches everything.
 */
export function filterByPrefix(entries: readonly string[], prefix: string): string[] {
  if (!prefix) return [...entries];
  return entries.filter((entry) => matchesPrefix(entry, prefix));
}

/**
 * The completion the most recent matching entry would add to `draft`, or "".
 *
 * Same match rule as `filterByPrefix`, so the hint can never advertise a
 * completion that cycling would refuse to produce.
 */
export function ghostSuffix(entries: readonly string[], draft: string): string {
  if (!draft) return "";
  const match = entries.find((entry) => matchesPrefix(entry, draft));
  return match === undefined ? "" : match.slice(draft.length);
}

/**
 * Bring `index` inside what `rowCount` rows can show, at BOTH ends (audit #387).
 *
 * An upper-only clamp let ArrowDown on an empty result pin the selection at
 * -1; the expression then had to be repeated at every stepping site, which is
 * how one end came to be clamped and the other not.
 */
export function clampToRows(index: number, rowCount: number): number {
  return Math.max(0, Math.min(index, rowCount - 1));
}

/* ─────────────────────── key-event vocabulary ─────────────────────── */

export type PromptKeyEvent = React.KeyboardEvent<HTMLTextAreaElement>;

/** One interaction layer: true when it claimed the key, which ends the walk. */
export type KeyLayer = (e: PromptKeyEvent) => boolean;

/** The key is ours: no browser default, no bubbling to the picker's own handler. */
export function consume(e: PromptKeyEvent): void {
  e.preventDefault();
  e.stopPropagation();
}
