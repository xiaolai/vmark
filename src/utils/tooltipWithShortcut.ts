/**
 * Purpose: Build a button tooltip string that appends a keyboard shortcut hint
 * only when one exists, avoiding an empty "()" when the shortcut is unbound.
 *
 * Leaf-pure (ADR-013): takes an already-formatted key so it never imports the
 * formatter from `stores/`. Callers format with `formatKeyForDisplay` first.
 *
 * @example tooltipWithShortcut("Open Sidebar", "⌃⇧0") // "Open Sidebar (⌃⇧0)"
 * @example tooltipWithShortcut("Open Sidebar", "")     // "Open Sidebar"
 */
export function tooltipWithShortcut(label: string, formattedKey: string): string {
  const key = formattedKey.trim();
  return key ? `${label} (${key})` : label;
}
