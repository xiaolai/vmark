/**
 * The ratchet manifest: every committed baseline, and what "loosening" means
 * for each one. Data, deliberately separated from the engine that reads it
 * (scripts/baselineRatchetModes.mjs) and the CLI that reports it
 * (scripts/check-baseline-ratchet.mjs) — this file changes whenever a gate is
 * added, the other two almost never.
 *
 * REGISTERING A NEW BASELINE IS PART OF ADDING ONE. A baseline-shaped file on
 * disk that is missing here fails the gate, and an entry here whose file is
 * gone fails too; see the discovery globs in the CLI's header.
 *
 * Entry schema:
 *   path      repo-relative path
 *   format    "json" (default) or "text" (compared by a custom comparator)
 *   checks    one or more:
 *     { mode: "scalar",        at }                    raising the number fails
 *     { mode: "per-key-count", at }                    raising any count fails;
 *                                                      nested maps flatten to
 *                                                      dotted keys
 *     { mode: "identity",      at, shape, key?, onAdd } a SET; "strings" |
 *                                                      "objects" (with `key`
 *                                                      fields) | "object-keys"
 *     { mode: "custom",        comparator, onAdd }     a named comparator
 *   `at` is a dotted path; "" is the document itself.
 *   `onAdd` is "fail" for lists whose own contract forbids additions, else
 *   "report" — additions are visible in the diff; raises and swaps are not.
 *
 * allowRaise entries permit exactly ONE re-measurement each and expire by
 * themselves: the declared from→to must match what actually happened, a reason
 * is mandatory, and the entry FAILS AS STALE once the base already carries the
 * raised value.
 *
 * @coordinates-with scripts/check-baseline-ratchet.mjs — the CLI that applies this
 */

/**
 * Every committed baseline, with how its loosening is defined. A file
 * discovered on disk and missing from here fails the gate; an entry here with
 * no file fails too.
 */
export const MANIFEST = {
  entries: [
    {
      path: "scripts/file-size-baseline.json",
      checks: [
        { mode: "scalar", at: "limit" },
        { mode: "scalar", at: "testLimit" },
        { mode: "per-key-count", at: "files" },
        { mode: "per-key-count", at: "testFiles" },
      ],
    },
    {
      // Six warn-tier knip families, each a plain count at the root.
      path: "scripts/knip-baseline.json",
      checks: [{ mode: "per-key-count", at: "" }],
    },
    {
      // Counts only. The collectors (collectBespokeButtons /
      // collectStyledButtonClasses) already return class→file maps, so an
      // identity conversion is cheap — but it changes the checker's contract
      // and its failure messages, which is a checker redesign and out of
      // scope here. Registered as scalars; convert when that gate is next
      // touched.
      path: "scripts/bespoke-buttons-baseline.json",
      checks: [
        { mode: "scalar", at: "maxBespokeButtonClasses" },
        { mode: "scalar", at: "maxStyledButtonClasses" },
      ],
    },
    {
      path: "scripts/extension-budget.json",
      checks: [
        { mode: "scalar", at: "maxKnownViolations" },
        { mode: "per-key-count", at: "maxRuleExemptions" },
      ],
    },
    {
      path: "scripts/command-error-baseline.json",
      checks: [{ mode: "per-key-count", at: "files" }],
    },
    {
      // unit → channel → count; flattening compares each channel separately.
      path: "scripts/plugin-store-coupling-baseline.json",
      checks: [{ mode: "per-key-count", at: "units" }],
    },
    {
      // minWords/minChars gate WHICH values count: raising either shrinks the
      // measured set, so both ratchet down like any other floor.
      path: "scripts/i18n-untranslated-baseline.json",
      checks: [
        { mode: "scalar", at: "minWords" },
        { mode: "scalar", at: "minChars" },
        // AGENTS.md: "the baseline is empty — keep it empty. A new entry means
        // a real regression, so translate the string."
        { mode: "identity", at: "entries", shape: "strings", onAdd: "fail" },
      ],
    },
    {
      // WI-18's identity list; its header: entries only get REMOVED.
      path: "scripts/mock-boundaries-baseline.json",
      checks: [
        {
          mode: "identity",
          at: "entries",
          shape: "objects",
          key: ["file", "api", "target"],
          onAdd: "fail",
        },
      ],
    },
    {
      // A new top-level surface legitimately needs an entry (check-shell-slots
      // fails when a mounted surface is missing), so additions report.
      path: "scripts/shell-slots-baseline.json",
      checks: [{ mode: "identity", at: "surfaces", shape: "strings", onAdd: "report" }],
    },
    {
      path: "scripts/merge-drop-allowlist.json",
      checks: [{ mode: "identity", at: "", shape: "object-keys", onAdd: "report" }],
    },
    {
      // Growth here is separately capped by extension-budget's
      // maxKnownViolations scalar, so per-edge additions report.
      path: ".dependency-cruiser-known-violations.json",
      checks: [
        {
          mode: "identity",
          at: "",
          shape: "objects",
          key: ["from", "to", "rule.name"],
          onAdd: "report",
        },
      ],
    },
    {
      // TypeScript, not JSON: compared through a named comparator over source
      // text, because the base version arrives from `git show` and cannot be
      // imported.
      path: "scripts/i18nIdenticalAllowlist.ts",
      format: "text",
      checks: [{ mode: "custom", comparator: "tsIdenticalAllowlist", onAdd: "report" }],
    },
  ],
  allowRaise: [
    {
      path: "scripts/extension-budget.json",
      key: "maxKnownViolations",
      from: 7,
      to: 75,
      reason:
        "WI-8 re-measurement: the 17 plugin-wide dependency-cruiser pathNot licenses were " +
        "retired and every masked edge frozen individually. Same debt, counted per-edge " +
        "instead of hidden plugin-wide (maxRuleExemptions.plugin-isolation fell 28→7 in the " +
        "same change). Delete this entry once it has landed on main.",
    },
  ],
};
