/**
 * The TEXT half of the command bus — how a command's label is resolved, folded
 * and ranked. Split out of `CommandBus.ts` (at its size cap); the bus keeps the
 * registry, the owner claims, the availability check and dispatch.
 *
 * Every rule here is one an audit finding named, and each is worth testing
 * without a registry: a getter that throws must not take down the palette
 * (#880), and two spellings of one string must compare equal (#882).
 *
 * @coordinates-with services/commands/CommandBus.ts — resolves + ranks through this
 * @coordinates-with components/CommandPalette/CommandPalette.tsx — renders resolved labels
 * @module services/commands/commandText
 */
import { menuError } from "@/utils/debug";

/**
 * Localized-string source. Pass a plain string for English-only labels,
 * or a getter function that resolves through i18n at display time —
 * useful when commands register synchronously before non-boot
 * namespaces are loaded.
 */
export type LocalizedString = string | (() => string);

/**
 * Resolve a LocalizedString to a plain string at the moment of display.
 *
 * NEVER THROWS (audit #880). A getter exists precisely because commands
 * register before their i18n namespace is loaded, so calling one can fail —
 * and both consumers are whole-list operations: `searchCommands` walks every
 * command, and the palette renders every row. One faulty getter therefore took
 * down the entire palette rather than one entry. `when` predicates were already
 * isolated for exactly this reason; this is the same rule for the label.
 */
export function resolveLocalizedString(
  value: LocalizedString | undefined,
  fallback = "",
): string {
  if (value === undefined) return "";
  if (typeof value !== "function") return value;
  try {
    return value();
  } catch (err) {
    menuError("Localized string getter threw; using the fallback label:", err);
    return fallback;
  }
}

/**
 * Fold a string for substring comparison.
 *
 * **NFC first.** "é" has two canonical spellings — one code point, or "e" plus
 * a combining acute — and they are not `includes()`-equal. A query typed one
 * way then simply does not match a title spelled the other, with no error and
 * no clue. Normalizing both sides to the SAME canonical form is what makes the
 * comparison mean "the same text".
 *
 * **`toLowerCase`, deliberately NOT `toLocaleLowerCase`.** Locale-aware folding
 * is the wrong tool here and would be a regression: under a Turkish locale it
 * maps "I" to "ı", so a Turkish user searching the ASCII command ids and
 * English titles this registry also carries would stop matching them. Palette
 * matching wants one locale-independent fold, applied identically to both
 * sides.
 */
export function foldForSearch(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

/** The fields a command is matched on, already folded. */
export interface SearchableCommand {
  title: string;
  id: string;
  description: string;
}

/**
 * Score a folded query against a folded command. 0 means "no match".
 *
 * Intentionally simple — palette UIs may layer fuzzy matching on top.
 * Foundation only.
 */
export function scoreCommand(query: string, command: SearchableCommand): number {
  if (command.title.startsWith(query)) return 100;
  if (command.title.includes(query)) return 50;
  if (command.id.includes(query)) return 25;
  if (command.description.includes(query)) return 10;
  return 0;
}
