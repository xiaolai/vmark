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
      // Which baselines are debt (WI-AF3.2). An IDENTITY list, so a baseline
      // cannot quietly stop being tracked — dropping a key is the loosening
      // that matters here. There are no deadlines to ratchet: an earlier
      // revision carried invented per-baseline dates, and inventing a date is
      // not made rigorous by policing it. `exempt` carries prose reasons and is
      // validated for shape by scripts/check-review-schedule.mjs, which also
      // enforces two-way coverage against THIS manifest.
      path: "scripts/baseline-review-schedule.json",
      checks: [{ mode: "identity", at: "tracked", shape: "object-keys", onAdd: "report" }],
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
        { mode: "scalar", at: "maxShapeDriftClasses" },
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
      // file → rule → count, so flattening compares each (file, rule) pair
      // separately. A single total would let a fixed floating promise pay for
      // a new one in an unrelated file — the like-for-like swap §11 warns
      // about. Line-level identity was rejected deliberately: line numbers
      // move on every unrelated edit, and a baseline that churns is one people
      // regenerate without reading.
      path: "scripts/type-aware-baseline.json",
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
    // ── Markdown spec tier (WI-0.3, plan ADR-5) ──────────────────────────
    // Declared-divergence ledgers: one identity per record; additions report
    // (visible in the diff), removals are tightening. Value drift is the spec
    // gates' own staleness check, not the ratchet's.
    {
      path: "src/utils/markdownPipeline/__tests__/spec/specDeltas.json",
      checks: [{ mode: "custom", comparator: "specConformanceRecords", onAdd: "report" }],
    },
    {
      path: "src/utils/markdownPipeline/__tests__/spec/specRoundtripDeltas.json",
      checks: [{ mode: "custom", comparator: "specRoundtripRecords", onAdd: "report" }],
    },
    // Vendored corpora: OPPOSITE polarity — content-addressed example
    // identities that may only be added, so removing or editing an example
    // fails even when the same commit updates the registry digest to match.
    {
      path: "src/utils/markdownPipeline/__tests__/spec/corpus/commonmark-0.31.2.json",
      checks: [
        { mode: "custom", comparator: "specCorpusExamples", direction: "no-remove", onAdd: "report" },
      ],
    },
    {
      path: "src/utils/markdownPipeline/__tests__/spec/corpus/gfm-extensions.json",
      checks: [
        { mode: "custom", comparator: "specCorpusExamples", direction: "no-remove", onAdd: "report" },
      ],
    },
    // WI-2.3's external corpora — identical contract per file.
    ...[
      "cmark-regression.json",
      "cmark-gfm-regression.json",
      "cmark-gfm-extensions.json",
      "pulldown-cjk-emphasis.json",
      "pulldown-wikilinks.json",
      "pulldown-math.json",
      "markdown-it-extras.json",
      "markdown-it-xss.json",
      "tiptap-conversion.json",
    ].map((file) => ({
      path: `src/utils/markdownPipeline/__tests__/spec/corpus/${file}`,
      checks: [
        { mode: "custom", comparator: "specCorpusExamples", direction: "no-remove", onAdd: "report" },
      ],
    })),
    // Pre-existing ledgers that predate the spec tier, previously
    // unregistered (self-attesting): now pinned via source-text parsing.
    {
      path: "src/utils/markdownPipeline/conformance/expectedDeltas.ts",
      format: "text",
      checks: [{ mode: "custom", comparator: "tsExpectedDeltas", onAdd: "report" }],
    },
    {
      path: "src/utils/markdownPipeline/__tests__/fidelity/fidelityLedger.ts",
      format: "text",
      checks: [{ mode: "custom", comparator: "tsFidelityLedger", onAdd: "report" }],
    },
  ],
  allowRaise: [],
};
