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
 *     { mode: "per-key-count", at, onAdd }             raising any count fails;
 *                                                      nested maps flatten to
 *                                                      dotted keys; a NEW key
 *                                                      is a raise from 0 under
 *                                                      onAdd "fail"
 *     { mode: "identity",      at, shape, key?, onAdd } a SET; "strings" |
 *                                                      "objects" (with `key`
 *                                                      fields) | "object-keys"
 *     { mode: "custom",        comparator, onAdd }     a named comparator
 *   `at` is a dotted path; "" is the document itself. An `at` ending in `.*`
 *   expands to one check per key of that object, read from the file itself at
 *   comparison time — for a baseline keyed by something the manifest should
 *   not have to restate (the theme catalog).
 *   `onAdd` is "fail" for lists whose own contract forbids additions, else
 *   "report" — additions are visible in the diff; raises and swaps are not.
 *   Every per-file COUNT baseline here is "fail": each of those gates already
 *   refuses a new dirty file, so a key added to the baseline in the same
 *   change is the self-attestation this script exists to catch. A rename that
 *   carries old debt under a new key is declared with an allowRaise from 0.
 *
 * allowRaise entries permit exactly ONE re-measurement each and expire by
 * themselves: the declared from→to must match what actually happened, a reason
 * is mandatory, and the entry FAILS AS STALE once the base already carries the
 * raised value.
 *
 * @coordinates-with scripts/check-baseline-ratchet.mjs — the CLI that applies this
 * @coordinates-with scripts/lib/baselineRatchet/advisoryAcceptanceEntries.mjs — the advisory registries spread in below
 * @coordinates-with scripts/lib/baselineRatchet/specTierEntries.mjs — the Markdown spec-tier entries spread in below
 */
import { ADVISORY_ACCEPTANCE_ENTRIES } from "./lib/baselineRatchet/advisoryAcceptanceEntries.mjs";
import { SPEC_TIER_ENTRIES } from "./lib/baselineRatchet/specTierEntries.mjs";

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
        { mode: "per-key-count", at: "files", onAdd: "fail" },
        { mode: "per-key-count", at: "testFiles", onAdd: "fail" },
      ],
    },
    {
      // Modules unreachable from every production root, measured by
      // scripts/check-test-only-modules.mjs over knip's production graph. An
      // IDENTITY list that only shrinks: a module only its tests reach is a
      // defect, so an addition fails here as well as in the gate itself.
      path: "scripts/test-only-modules-baseline.json",
      checks: [{ mode: "identity", at: "entries", shape: "strings", onAdd: "fail" }],
    },
    {
      // Header references (@coordinates-with, @module, Plan:) that
      // resolve to nothing, measured by scripts/check-header-references.mjs.
      // IDENTITY list, only shrinks: a new dangling reference is a comment
      // written against a file that does not exist, so additions fail.
      path: "scripts/header-references-baseline.json",
      checks: [{ mode: "identity", at: "entries", shape: "strings", onAdd: "fail" }],
    },
    {
      // Which baselines are debt (WI-AF3.2). Registered as an IDENTITY list so
      // the diff of its keys is REPORTED here; the loosening that matters — a
      // baseline quietly dropping out of `tracked` — is refused by
      // scripts/check-review-schedule.mjs, whose two-way coverage fails when a
      // manifest entry is neither tracked nor exempt (and when a key names no
      // baseline). That gate, not this check, is what makes a drop loud: an
      // identity check without `direction: "no-remove"` sees additions only.
      // There are no deadlines to ratchet: an earlier
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
      checks: [{ mode: "per-key-count", at: "", onAdd: "fail" }],
    },
    {
      // Per-file type-error counts for the TEST corpus, which `tsconfig.json`
      // excludes and `pnpm typecheck` therefore never saw. A count rather than
      // an identity list is a deliberate weakening: two errors on different
      // lines of one file are indistinguishable without pinning line numbers,
      // and a baseline that churns on every edit above a frozen error is a
      // baseline people delete. The unit that matters — this file is dirty,
      // and by how much — survives.
      path: "scripts/test-types-baseline.json",
      checks: [{ mode: "per-key-count", at: "", onAdd: "fail" }],
    },
    {
      // IDENTITY lists, only shrink. They were scalar counts, which let a
      // swap through — delete one bespoke button, write another, total held.
      // An addition fails here as well as in the gate itself.
      path: "scripts/bespoke-buttons-baseline.json",
      checks: [
        { mode: "identity", at: "bespokeButtonClasses", shape: "strings", onAdd: "fail" },
        { mode: "identity", at: "styledButtonClasses", shape: "strings", onAdd: "fail" },
        { mode: "identity", at: "shapeDriftClasses", shape: "strings", onAdd: "fail" },
      ],
    },
    {
      path: "scripts/extension-budget.json",
      checks: [
        { mode: "scalar", at: "maxKnownViolations" },
        { mode: "per-key-count", at: "maxRuleExemptions", onAdd: "fail" },
      ],
    },
    {
      path: "scripts/command-error-baseline.json",
      checks: [{ mode: "per-key-count", at: "files", onAdd: "fail" }],
    },
    {
      // file → rule → count, so flattening compares each (file, rule) pair
      // separately. A single total would let a fixed floating promise pay for
      // a new one in an unrelated file — the like-for-like swap §11 warns
      // about. Line-level identity was rejected deliberately: line numbers
      // move on every unrelated edit, and a baseline that churns is one people
      // regenerate without reading.
      path: "scripts/type-aware-baseline.json",
      checks: [{ mode: "per-key-count", at: "files", onAdd: "fail" }],
    },
    {
      // unit → channel → count; flattening compares each channel separately.
      path: "scripts/plugin-store-coupling-baseline.json",
      checks: [{ mode: "per-key-count", at: "units", onAdd: "fail" }],
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
      // Casing/punctuation conventions (R14). Identity list of
      // "file:key:check" violations in the ENGLISH copy; ratchets down only.
      path: "scripts/i18n-copy-baseline.json",
      checks: [{ mode: "identity", at: "entries", shape: "strings", onAdd: "fail" }],
    },
    {
      // The store-mock list; its header: entries only get REMOVED.
      // Sibling logic mocks have no list — none are allowed.
      path: "scripts/mock-boundaries-baseline.json",
      checks: [{ mode: "identity", at: "entries", shape: "objects", key: ["file", "api", "target"], onAdd: "fail" }],
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
    // Reviewed npm and RustSec advisory acceptances (additions report).
    ...ADVISORY_ACCEPTANCE_ENTRIES,
    {
      // The Rust line-coverage floor, stored as the ceiling on UNCOVERED lines
      // so that it reads the way a scalar check does: a raise loosens the gate
      // and fails here. `maxSlackPercent` is how far coverage may rise above
      // the floor before `check-rust-coverage.mjs` calls the floor stale, so
      // raising it loosens that half and fails too.
      path: "scripts/rust-coverage-baseline.json",
      checks: [
        { mode: "scalar", at: "maxUncoveredLinePercent" },
        { mode: "scalar", at: "maxSlackPercent" },
      ],
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
      // The catalog contrast gate's identity baseline. Each theme's
      // failing-pair list is a SEPARATE identity check (shape "strings",
      // onAdd: "fail") because `object-keys` at `failing` would only see theme
      // names — a pair added under an existing theme would pass silently, the
      // exact count-like substitution §11 forbids (Codex objection #13,
      // verified by fixture in check-baseline-ratchet.test.mjs). The per-theme
      // checks are DERIVED from the file's own `failing` keys (`failing.*`),
      // not named here: a hand-kept list of six themes left a seventh's list
      // unratcheted until someone remembered the manifest.
      // The object-keys check remains for the ARRIVAL of a theme (report — a
      // 7th theme legitimately adds a key). `ansiFloor`/`exempt` go through the
      // contrastFloors PAIR comparator: value may only rise, reason required.
      path: "scripts/theme-contrast-baseline.json",
      checks: [
        { mode: "identity", at: "failing", shape: "object-keys", onAdd: "report" },
        { mode: "identity", at: "failing.*", shape: "strings", onAdd: "fail" },
        { mode: "custom", comparator: "contrastFloors", onAdd: "report" },
      ],
    },
    {
      // The ui-consistency gate's identity lists, one per check.
      // Registered per-check (not root object-keys) for the same reason as the
      // theme-contrast baseline: a site added under an existing check must
      // fail. C4 alone reports additions — a NEW overlay surface legitimately
      // adds a shell, and the diff shows it; every other list only shrinks.
      path: "scripts/ui-consistency-baseline.json",
      checks: [
        ...["C3", "C5", "C7", "C8", "C9", "C10", "C11"].map((check) => ({
          mode: "identity",
          at: check,
          shape: "strings",
          onAdd: "fail",
        })),
        { mode: "identity", at: "C4", shape: "strings", onAdd: "report" },
      ],
    },
    {
      // C12 — check:static gates with no sibling self-test. The
      // parity test enforces exact equality with the census, so this ratchet's
      // job is only to stop the list growing back via history the PR wrote.
      path: "scripts/gate-tests-baseline.json",
      checks: [{ mode: "identity", at: "untested", shape: "strings", onAdd: "fail" }],
    },
    {
      // Identity lists for the two non-zero declaration-integrity
      // checks (C2b rgba literals PER DECLARATION — file:selector:prop, so a
      // baselined selector cannot accumulate new colour literals invisibly;
      // renamed from the per-rule `rgbaLiterals` in the same change that
      // re-measured it — and C2g className literals by file+token).
      // Everything else in check-design-tokens.mjs is zero-tolerance and has
      // no baseline to register.
      path: "scripts/design-tokens-baseline.json",
      checks: [
        { mode: "identity", at: "rgbaLiteralDecls", shape: "strings", onAdd: "fail" },
        { mode: "identity", at: "classNames", shape: "strings", onAdd: "fail" },
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
    // ── Markdown spec tier (plan ADR-5) ── declared-divergence
    // ledgers, vendored corpora and the two pre-spec TS ledgers; the entries
    // and their reasoning live in their own module.
    ...SPEC_TIER_ENTRIES,
  ],
  // Empty by design. An entry here permits exactly ONE re-measurement and is
  // deleted by the PR that follows the one carrying it — the entries
  // for the three `#[command]`-visibility files in command-error-baseline.json
  // expired when 76589b510 landed those counts, which is the gate reporting
  // them stale rather than anyone remembering.
  allowRaise: [],
};
