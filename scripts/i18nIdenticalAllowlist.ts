/**
 * Values that are legitimately byte-identical to English, with a stated reason.
 *
 * `pnpm lint:i18n` flags any value a locale shares with English (at >=3 words
 * and >=15 characters). Most such values are real debt. A few can never be
 * anything else: a literal filesystem path, literal GitHub Actions runner
 * labels, a format string with no words in it, or a term whose translation in
 * that language IS the English word.
 *
 * Those used to live in `i18n-untranslated-baseline.json`, whose contract is
 * "translate these, the count only goes down". They could not be actioned and
 * could not be removed, so the baseline could never reach zero — and a
 * genuinely new untranslated string had to be noticed among permanent
 * residents. Separating the two makes the baseline mean one thing.
 *
 * The list is checked in BOTH directions (see `staleExceptions`): an exemption
 * whose value is no longer identical must be deleted, so translating an
 * exempted string cannot silently leave a dead exemption behind. This mirrors
 * `src/locales/__tests__/terminalI18nCoverage.test.ts`, which pioneered the
 * pattern for the `terminal.*` subtree.
 *
 * Adding an entry here is a claim that the string is UNTRANSLATABLE, not that
 * translating it is inconvenient. If in doubt, translate it.
 *
 * @coordinates-with scripts/check-i18n-keys.ts (sole consumer)
 */

export interface IdenticalException {
  /** `json` = `src/locales/<locale>/<ns>`; `yaml` = `src-tauri/locales/<locale>.yml`. */
  kind: "json" | "yaml";
  /** Namespace filename for `json` entries, e.g. `settings.json`. Unused for `yaml`. */
  ns: string;
  /** Flattened key, e.g. `files.autoResize.1920`. */
  key: string;
  /** Locales the exemption applies to. */
  locales: string[];
  /** Why this value cannot be translated. */
  reason: string;
}

const ALL_LOCALES = ["de", "es", "fr", "it", "ja", "ko", "pt-BR", "zh-CN", "zh-TW"];

export const IDENTICAL_ALLOWLIST: IdenticalException[] = [
  {
    kind: "json",
    ns: "settings.json",
    key: "formats.externalEditor.placeholder",
    locales: ALL_LOCALES,
    reason:
      "A literal macOS application path (/Applications/Visual Studio Code.app) shown as " +
      "an input placeholder. Translating any part of it would suggest a path that does not exist.",
  },
  {
    kind: "json",
    ns: "workflowEditor.json",
    key: "form.job.runsOn.placeholder",
    locales: ALL_LOCALES,
    reason:
      "Literal GitHub Actions runner labels (ubuntu-latest / self-hosted / linux / x64). " +
      "They are values the user types verbatim into the workflow file, not prose.",
  },
  {
    kind: "json",
    ns: "statusbar.json",
    key: "terminal.search.results",
    locales: ALL_LOCALES,
    reason:
      'Pure interpolation ("{{index}} / {{count}}") — there is no word in it to translate.',
  },
  {
    kind: "json",
    ns: "settings.json",
    key: "files.autoResize.1920",
    locales: ALL_LOCALES,
    reason:
      '"1920px (Full HD)" — a pixel count plus a display-industry term that is used ' +
      "untranslated in all nine locales.",
  },
  {
    kind: "json",
    ns: "settings.json",
    key: "language.quoteStyle.guillemets",
    locales: ["de", "fr"],
    reason:
      '"Guillemets" is the French word for the mark and the standard loanword in German; ' +
      "the other seven locales use their own term and are translated.",
  },
  {
    kind: "json",
    ns: "settings.json",
    key: "language.consecutivePunctuation.double",
    locales: ["fr"],
    reason:
      '"Double" is the French word, and the rest of the string is the punctuation ' +
      "example (!!! → !!) that carries the meaning.",
  },
  {
    kind: "json",
    ns: "settings.json",
    key: "language.cjkParenthesisSpacing.description",
    locales: ["it"],
    reason:
      'A literal before/after example ("Test (test) -> Test (test)"), and "Test" is ' +
      "the Italian word too. Translating the sample would not demonstrate the rule any better.",
  },
];

/** Baseline-format entries (`<path>:<key>`) an exception covers. */
export function exceptionEntries(e: IdenticalException): string[] {
  return e.locales.map((locale) =>
    e.kind === "yaml"
      ? `src-tauri/locales/${locale}.yml:${e.key}`
      : `src/locales/${locale}/${e.ns}:${e.key}`,
  );
}

/** Every entry the allow-list exempts, as a lookup set. */
export function allowedEntries(
  list: IdenticalException[] = IDENTICAL_ALLOWLIST,
): Set<string> {
  return new Set(list.flatMap(exceptionEntries));
}

/**
 * Exemptions that no longer describe reality — the value has since been
 * translated (or the key removed), so the entry is dead weight and must go.
 */
export function staleExceptions(
  list: IdenticalException[],
  actuallyIdentical: Set<string>,
): string[] {
  return list
    .flatMap(exceptionEntries)
    .filter((entry) => !actuallyIdentical.has(entry));
}
