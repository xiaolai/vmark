/**
 * Custom comparators for the markdown spec tier's governed baselines
 * (WI-0.3, plan ADR-5).
 *
 * Three kinds of file, three identity notions:
 *   - JSON ledgers (`specDeltas.json`, `specRoundtripDeltas.json`): one
 *     identity per declared-divergence record. Additions REPORT (a new
 *     declaration is an addition in the diff, legible to any reader);
 *     removals are tightening and pass silently. Values are deliberately NOT
 *     part of the identity — the gates themselves fail a record whose values
 *     drifted (stale), so the ratchet only needs to see record membership.
 *   - Vendored corpora (`corpus/*.json`): one identity per example, INCLUDING
 *     a digest of its markdown. Checked with `direction: "no-remove"` —
 *     coverage only grows, so a removed or silently EDITED example fails at
 *     the merge base even if the same-commit registry digest was updated to
 *     match.
 *   - Pre-existing TS ledgers (`conformance/expectedDeltas.ts`,
 *     `fidelity/fidelityLedger.ts`): identities parsed structurally from
 *     source text, reusing the i18n allowlist's parser (a `git show` of a
 *     historical ref cannot be imported).
 *
 * @coordinates-with scripts/baselineRatchetModes.mjs — registers these
 * @coordinates-with scripts/baselineRatchetManifest.mjs — the entries using them
 * @coordinates-with src/utils/markdownPipeline/__tests__/spec/ — the tier governed here
 */
import { createHash } from "node:crypto";
import {
  tsObjectArrayIdentities,
  tsRecordOfArraysIdentities,
} from "./baselineRatchetTsAllowlist.mjs";

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array`);
  return value;
}

function requireString(value, label, field) {
  if (typeof value !== "string") throw new Error(`${label}: record is missing string field "${field}"`);
  return value;
}

/** `specDeltas.json` → one identity per conformance record. */
export function specConformanceRecords(doc, label) {
  const out = new Set();
  for (const d of requireArray(doc?.deltas, label)) {
    out.add(
      ["exampleId", "path", "kind", "detail", "verdict"]
        .map((f) => requireString(d[f], label, f))
        .join(" | "),
    );
  }
  return out;
}

/** `specRoundtripDeltas.json` → one identity per stability + fidelity record. */
export function specRoundtripRecords(doc, label) {
  const out = new Set();
  for (const d of requireArray(doc?.stability, label)) {
    out.add(
      ["stability", ...["exampleId", "pass1Sha256", "pass2Sha256"].map((f) => requireString(d[f], label, f))].join(" | "),
    );
  }
  for (const d of requireArray(doc?.fidelity, label)) {
    out.add(
      ["fidelity", ...["exampleId", "path", "kind", "detail", "verdict"].map((f) => requireString(d[f], label, f))].join(" | "),
    );
  }
  // WI-2.2's independent-ruler section arrived after the first ledgers; a
  // base-ref file may predate it, so absence reads as empty, not malformed.
  for (const d of requireArray(doc?.independentRuler ?? [], label)) {
    out.add(
      ["independentRuler", ...["exampleId", "path", "kind", "detail", "verdict"].map((f) => requireString(d[f], label, f))].join(" | "),
    );
  }
  return out;
}

/** `corpus/*.json` → one identity per example, content-addressed. */
export function specCorpusExamples(doc, label) {
  const out = new Set();
  for (const e of requireArray(doc?.examples, label)) {
    if (typeof e.example !== "number") throw new Error(`${label}: example without a number`);
    const markdown = requireString(e.markdown, label, "markdown");
    const digest = createHash("sha256").update(markdown, "utf8").digest("hex").slice(0, 16);
    out.add(`${e.example} | ${digest}`);
  }
  return out;
}

/** `conformance/expectedDeltas.ts` → one identity per declared delta. */
export function tsExpectedDeltas(source, label) {
  return tsObjectArrayIdentities(
    source,
    "EXPECTED_DELTAS",
    ["fixtureId", "path", "kind", "detail"],
    label,
  );
}

/** `fidelity/fidelityLedger.ts` → one `document | rule` identity per entry. */
export function tsFidelityLedger(source, label) {
  return tsRecordOfArraysIdentities(source, "FIDELITY_LEDGER", "rule", label);
}
