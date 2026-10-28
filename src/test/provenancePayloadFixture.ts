/**
 * Test helper — a well-typed provenance payload for tests that only carry
 * a map through (wire pass-through, retry, stand-in sources), so they need
 * no cast. The values are a valid identity shape, not a map any journal
 * would certify: tests that check certification build a real payload with
 * `encodePayload`.
 *
 * @module test/provenancePayloadFixture
 */

import type { ProvenancePayload } from "@/services/agentJournal/provenance/payload";

/** An identity-shaped payload over empty text; `overrides` replaces top-level fields. */
export function stubProvenancePayload(overrides: Partial<ProvenancePayload> = {}): ProvenancePayload {
  return {
    provenanceVersion: 1,
    unit: "utf16CodeUnit",
    cap: 16384,
    document: "00000000-0000-0000-0000-000000000000",
    epoch: "1",
    basis: "genesis",
    preHash: "0".repeat(64),
    postHash: "0".repeat(64),
    body: {
      lenA: 0,
      lenB: 0,
      transactions: 0,
      map: { L0: 0, R0: 0, runs: [] },
      deletedChars: [],
      touchedGaps: [],
      breaks: { whole: null, bounded: [] },
    },
    ...overrides,
  };
}
