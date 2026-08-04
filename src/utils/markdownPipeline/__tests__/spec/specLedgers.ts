/**
 * Purpose: typed access to the spec gates' declared-divergence ledgers
 * (WI-0.1, ADR-1).
 *
 * The ledgers are JSON DATA (`specDeltas.json`, `specRoundtripDeltas.json`),
 * not code: JSON is what the merge-base ratchet
 * (`scripts/check-baseline-ratchet.mjs`) can read at a historical ref, so
 * storing records as data is what makes ADR-5's identity ratchet possible.
 *
 * Every record pins an EXACT divergence signature — example id, path, kind,
 * detail, and BOTH observed values — mirroring `conformance/expectedDeltas.ts`.
 * An id-only declaration is a wildcard: once declared, any different or larger
 * divergence on that example would also pass, which is the suppression-file
 * failure the older tier's header already documents. `matches()` therefore
 * refuses anything looser than a full-signature match.
 *
 * JSON cannot hold `undefined`, but divergence values can be (an attribute
 * present on one side only). The sentinel `"__undefined__"` spells it in the
 * data; `reviveValue` maps it back before comparison.
 *
 * @coordinates-with specDeltas.json — conformance ledger records
 * @coordinates-with specRoundtripDeltas.json — roundtrip ledger records
 * @coordinates-with ../../conformance/semanticProjection.ts — Divergence shape
 * @module utils/markdownPipeline/__tests__/spec/specLedgers
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sameValue, type Divergence } from "../../conformance/semanticProjection";

export const UNDEFINED_SENTINEL = "__undefined__";

export type ConformanceVerdict = "extension" | "defect";
export type FidelityVerdict = "defect" | "model-limit" | "normalization" | "policy";

export interface ConformanceDelta {
  exampleId: string;
  path: string;
  kind: Divergence["kind"];
  detail: string;
  vmarkValue: unknown;
  referenceValue: unknown;
  verdict: ConformanceVerdict;
  reason: string;
}

export interface StabilityDelta {
  exampleId: string;
  /** sha256 of the first and second serializer passes — the oscillation's
   *  exact identity. A serializer change that alters either output makes the
   *  entry stale, forcing re-triage instead of silently re-covering. */
  pass1Sha256: string;
  pass2Sha256: string;
  reason: string;
}

export interface FidelityDelta {
  exampleId: string;
  path: string;
  kind: Divergence["kind"];
  detail: string;
  inputValue: unknown;
  outputValue: unknown;
  verdict: FidelityVerdict;
  reason: string;
}

interface ConformanceLedgerFile {
  deltas: ConformanceDelta[];
}

interface RoundtripLedgerFile {
  stability: StabilityDelta[];
  fidelity: FidelityDelta[];
}

const here = dirname(fileURLToPath(import.meta.url));

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(here, file), "utf8")) as T;
}

/** Map the JSON spelling of `undefined` back to the value itself. */
export function reviveValue(value: unknown): unknown {
  return value === UNDEFINED_SENTINEL ? undefined : value;
}

export function loadConformanceLedger(): ConformanceDelta[] {
  const parsed = readJson<ConformanceLedgerFile>("specDeltas.json");
  return parsed.deltas;
}

export function loadRoundtripLedger(): RoundtripLedgerFile {
  return readJson<RoundtripLedgerFile>("specRoundtripDeltas.json");
}

/** Full-signature match — anything looser is a wildcard. */
export function conformanceMatches(
  delta: ConformanceDelta,
  divergence: Divergence,
  exampleId: string,
): boolean {
  return (
    delta.exampleId === exampleId &&
    delta.path === divergence.path &&
    delta.kind === divergence.kind &&
    delta.detail === divergence.detail &&
    sameValue(reviveValue(delta.vmarkValue), divergence.documentValue) &&
    sameValue(reviveValue(delta.referenceValue), divergence.sourcePositionValue)
  );
}

/** Full-signature match for the roundtrip fidelity leg. */
export function fidelityMatches(
  delta: FidelityDelta,
  divergence: Divergence,
  exampleId: string,
): boolean {
  return (
    delta.exampleId === exampleId &&
    delta.path === divergence.path &&
    delta.kind === divergence.kind &&
    delta.detail === divergence.detail &&
    sameValue(reviveValue(delta.inputValue), divergence.documentValue) &&
    sameValue(reviveValue(delta.outputValue), divergence.sourcePositionValue)
  );
}

/** Required on every record; a delta nobody can explain is a written-down bug. */
export function reasonsAreStated(
  records: readonly { reason: string; exampleId: string }[],
): string[] {
  return records.filter((r) => r.reason.trim().length < 20).map((r) => r.exampleId);
}
