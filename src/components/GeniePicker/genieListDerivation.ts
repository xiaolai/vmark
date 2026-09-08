/**
 * The genie picker's list, as pure functions (audit R3 #603/#607/#609/#621).
 *
 * Purpose: the picker derived its own list inline — filter, recents, group,
 * flatten — in four `useMemo`s that could only be exercised by rendering the
 * whole overlay. Two of them restated rules the genies store already
 * implements and exports (`searchGenies`, `getGroupedByCategory`), and the
 * copies were free to drift.
 *
 * `filterGenies` below is the ONE statement of the match rule the picker uses,
 * and `genieListDerivation.test.ts` asserts it agrees with the store's
 * `searchGenies` over a table of queries and scopes — so the two cannot part
 * ways silently. (Calling the store's function outright would be better still;
 * it is not reachable from here without either duplicating it into the
 * picker's test mock or editing the store, and a mock that restates the
 * algorithm is a third copy, not one fewer.)
 *
 * Three rules worth stating, because each was a defect:
 *
 *   - The query is TRIMMED once, at the source. The picker searched on the raw
 *     value, showed the no-match hint on raw truthiness, and submitted on the
 *     trimmed one — so whitespace alone hid every genie and offered a freeform
 *     hint whose Enter did nothing (#621).
 *   - An uncategorised genie's heading is the caller's TRANSLATED string, not a
 *     hardcoded English "Uncategorized" (#609).
 *   - A genie already in the recents section is not repeated below it — but
 *     ONLY while that section is on screen, which it is not while searching.
 *
 * @coordinates-with src/components/GeniePicker/GeniePicker.tsx — the consumer
 * @coordinates-with src/stores/aiStore/genies.ts — searchGenies / getRecent
 * @module components/GeniePicker/genieListDerivation
 */
import type { GenieDefinition, GenieScope } from "@/types/aiGenies";

/**
 * Does `genie` match `query` within `scope`? Name, description and category are
 * searched, case-insensitively; an empty query matches everything in scope.
 */
function matchesQuery(
  genie: GenieDefinition,
  query: string,
  scope: GenieScope | null,
): boolean {
  if (scope && genie.metadata.scope !== scope) return false;
  if (query === "") return true;
  const lower = query.toLowerCase();
  return (
    genie.metadata.name.toLowerCase().includes(lower) ||
    genie.metadata.description.toLowerCase().includes(lower) ||
    (genie.metadata.category?.toLowerCase().includes(lower) ?? false)
  );
}

/** Every genie matching `query` within `scope`, in declaration order. */
export function filterGenies(
  genies: readonly GenieDefinition[],
  query: string,
  scope: GenieScope | null,
): GenieDefinition[] {
  return genies.filter((g) => matchesQuery(g, query, scope));
}

export interface GenieListSections {
  /** Categories in encounter order, each with the genies below it. */
  grouped: Map<string, GenieDefinition[]>;
  /** Recents then every group, in render order — the order the keyboard walks. */
  flat: GenieDefinition[];
}

/**
 * The recent genies, resolved from their names — the store's `getRecent` as a
 * PURE function of the two values it reads.
 *
 * Taking those two as parameters is what makes the picker's memo honest (#608):
 * `addRecent` writes `recentGenieNames` and leaves `genies` alone, so a hook
 * that read the store imperatively went on showing the previous order until
 * something else happened to reload. `genieListDerivation.test.ts` pins this
 * against the store's own `getRecent`.
 */
export function recentGeniesOf(
  genies: readonly GenieDefinition[],
  recentNames: readonly string[],
): GenieDefinition[] {
  return recentNames
    .map((name) => genies.find((g) => g.metadata.name === name))
    .filter((g): g is GenieDefinition => g !== undefined);
}

/** The search text, normalized once: a whitespace-only query is no query. */
export function genieQuery(raw: string): string {
  return raw.trim();
}

/**
 * The recents to show: none while a query is active (the results are the
 * answer), and only those matching the active scope.
 */
export function scopedRecents(
  recents: readonly GenieDefinition[],
  activeScope: GenieScope | null,
  query: string,
): GenieDefinition[] {
  if (query !== "") return [];
  return recents.filter((g) => !activeScope || g.metadata.scope === activeScope);
}

/**
 * Group `matches` under their category headings and flatten the whole list.
 *
 * `recents` are excluded from the groups only when they have their own section
 * above — which is exactly when `recents` is non-empty, since `scopedRecents`
 * already returns nothing while searching.
 */
export function buildGenieList(
  matches: readonly GenieDefinition[],
  recents: readonly GenieDefinition[],
  uncategorizedLabel: string,
): GenieListSections {
  const grouped = new Map<string, GenieDefinition[]>();
  const recentNames = new Set(recents.map((r) => r.metadata.name));
  for (const g of matches) {
    if (recents.length > 0 && recentNames.has(g.metadata.name)) continue;
    const category = g.metadata.category ?? uncategorizedLabel;
    const list = grouped.get(category) ?? [];
    list.push(g);
    grouped.set(category, list);
  }
  const flat = [...recents];
  for (const list of grouped.values()) flat.push(...list);
  return { grouped, flat };
}
