/**
 * The ALL-INGRESS MATRIX — Phase 1's closing gate (WI-1.9).
 *
 * Every `IngestOrigin` × every line-ending shape: content canonical, metadata
 * decided by the origin's policy, and — for the origins that speak for the
 * file — the SAVE pipeline's real output byte-identical to what was read,
 * under `preserve`. The save half runs through the exported
 * `normalizeSaveContent`, not a reimplementation that could drift from it.
 *
 * The structural half: an origin added to `INGEST_ORIGINS` without a matrix
 * row fails here, so the matrix cannot silently under-cover.
 *
 * One documented exception, per decision D2: MIXED endings are not
 * byte-round-trippable by design — `detectLineEnding` answers `crlf` when any
 * CRLF exists, so `preserve` normalises the whole file to CRLF. The matrix
 * asserts that DOCUMENTED normalisation instead of pretending fidelity.
 *
 * @coordinates-with utils/ingestOrigin.ts — the policies under test
 * @coordinates-with services/persistence/saveToPath.ts — normalizeSaveContent
 * @module stores/documentStore/__tests__/ingestMatrix.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      general: { lineEndingsOnSave: "preserve" },
      markdown: { hardBreakStyleOnSave: "preserve" },
    })),
    // The documentStore barrel's lint module subscribes at import time.
    subscribe: vi.fn(),
  },
}));

import { useDocumentStore } from "@/stores/documentStore";
import { normalizeSaveContent } from "@/services/persistence/saveToPath";
import { INGEST_ORIGINS, type IngestOrigin } from "@/utils/ingestOrigin";

const TAB = "tab-matrix";
const BOM = "\u{FEFF}";

const doc = () => useDocumentStore.getState().documents[TAB];

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
});

/** The line-ending shapes every origin must handle. */
const SHAPES = [
  { label: "LF", raw: "alpha\nbeta\n", lineEnding: "lf" },
  { label: "CRLF", raw: "alpha\r\nbeta\r\n", lineEnding: "crlf" },
  { label: "CRLF+BOM", raw: `${BOM}alpha\r\nbeta\r\n`, lineEnding: "crlf" },
  // Any CRLF ⇒ crlf (decision D2) — and NOT byte-round-trippable, see below.
  { label: "mixed", raw: "alpha\r\nbeta\ngamma\n", lineEnding: "crlf" },
  { label: "empty", raw: "", lineEnding: "unknown" },
] as const;

/**
 * How each origin enters the matrix. Keyed by origin so the exhaustiveness
 * check below can demand a row for every member of the union.
 */
const ROWS: Record<
  IngestOrigin,
  { setup: (raw: string) => void; baseline: boolean; derives: boolean }
> = {
  "disk-open": {
    setup: (raw) =>
      useDocumentStore.getState().ingestExternalContent(TAB, raw, "disk-open", {
        filePath: "/m.md",
      }),
    baseline: true,
    derives: true,
  },
  "hot-exit-restore": {
    // Persisted metadata UNKNOWN, so the derive path runs — the persisted-wins
    // path is pinned separately in ingestExternalContent.test.ts. `deriveFrom`
    // carries the raw bytes exactly as restoreHelpers passes last_disk_content.
    setup: (raw) =>
      useDocumentStore.getState().ingestExternalContent(TAB, raw, "hot-exit-restore", {
        filePath: "/m.md",
        persisted: { lineEnding: "unknown" },
        deriveFrom: raw,
      }),
    baseline: true,
    derives: true,
  },
  "crash-recovery": {
    // An EDIT: recovered work stays dirty against the empty baseline the
    // recovery path creates first.
    setup: (raw) => {
      useDocumentStore.getState().initDocument(TAB, "", "/m.md", "");
      useDocumentStore.getState().ingestExternalContent(TAB, raw, "crash-recovery");
    },
    baseline: false,
    derives: true,
  },
  "mcp-write": {
    // An EDIT that does not redefine the document's convention: the doc is
    // seeded LF-from-disk, then the payload arrives in whatever shape.
    setup: (raw) => {
      useDocumentStore.getState().ingestExternalContent(TAB, "seed\n", "disk-open", {
        filePath: "/m.md",
      });
      useDocumentStore.getState().ingestExternalContent(TAB, raw, "mcp-write");
    },
    baseline: false,
    derives: false,
  },
};

describe("matrix exhaustiveness — the gate itself", () => {
  it("every declared origin has a matrix row, and no phantom rows exist", () => {
    expect(Object.keys(ROWS).sort()).toEqual([...INGEST_ORIGINS].sort());
  });
});

for (const origin of INGEST_ORIGINS) {
  const row = ROWS[origin];

  describe(`matrix: ${origin}`, () => {
    it.each([...SHAPES])("$label — content is canonical", ({ raw }) => {
      row.setup(raw);
      expect(doc()?.content).not.toContain("\r");
      expect(doc()?.content.startsWith(BOM)).toBe(false);
    });

    if (row.derives) {
      it.each([...SHAPES])("$label — lineEnding derives as $lineEnding", ({ raw, lineEnding }) => {
        row.setup(raw);
        expect(doc()?.lineEnding).toBe(lineEnding);
      });
    } else {
      it.each([...SHAPES])("$label — the document's convention is untouched", ({ raw }) => {
        row.setup(raw);
        expect(doc()?.lineEnding).toBe("lf"); // the seeded disk convention
      });
    }

    if (row.baseline) {
      it("arrives CLEAN — the ingested text is the saved state", () => {
        row.setup("alpha\r\nbeta\r\n");
        expect(doc()?.isDirty).toBe(false);
      });

      it.each([
        // Byte round-trip under `preserve` through the REAL save pipeline.
        { label: "LF", raw: "alpha\nbeta\n" },
        { label: "CRLF", raw: "alpha\r\nbeta\r\n" },
        { label: "CRLF+BOM", raw: `${BOM}alpha\r\nbeta\r\n` },
        { label: "empty", raw: "" },
      ])("$label — round-trips byte-identical under preserve", ({ raw }) => {
        row.setup(raw);
        const out = normalizeSaveContent(TAB, doc()!.content).output;
        expect(out).toBe(raw);
      });

      it("mixed endings normalise to all-CRLF on save — decision D2, not fidelity", () => {
        row.setup("alpha\r\nbeta\ngamma\n");
        const out = normalizeSaveContent(TAB, doc()!.content).output;
        expect(out).toBe("alpha\r\nbeta\r\ngamma\r\n");
      });
    } else {
      it("arrives DIRTY — an edit is not a save", () => {
        row.setup("edited text");
        expect(doc()?.isDirty).toBe(true);
      });
    }
  });
}
