// @vitest-environment node
// WI-1.3 — metadata precedence per ingress origin
import { describe, it, expect } from "vitest";
import {
  INGEST_ORIGINS,
  INGEST_ORIGIN_POLICY,
  INGEST_ORIGIN_SNAPSHOT,
  resolveIngestMetadata,
  type IngestOrigin,
  type LineMetadata,
} from "./ingestOrigin";

const meta = (
  lineEnding: LineMetadata["lineEnding"],
  hardBreakStyle: LineMetadata["hardBreakStyle"] = "unknown",
): LineMetadata => ({ lineEnding, hardBreakStyle });

describe("IngestOrigin exhaustiveness", () => {
  // The union and the table are one source apiece; a new origin added to the
  // list without a rule is a TYPE error at build time and a failure here at
  // test time. Rev 1 had neither — origin was per-call-site folklore.
  it("has a policy for every declared origin", () => {
    for (const origin of INGEST_ORIGINS) {
      expect(INGEST_ORIGIN_POLICY[origin]).toBeDefined();
    }
  });

  it("declares no policy for an origin outside the union", () => {
    expect(Object.keys(INGEST_ORIGIN_POLICY).sort()).toEqual([...INGEST_ORIGINS].sort());
  });

  // Two INDEPENDENT axes, so an origin can be exhaustively covered by one table
  // and silently missing from the other.
  it("has a snapshot policy for every declared origin, and no others", () => {
    expect(Object.keys(INGEST_ORIGIN_SNAPSHOT).sort()).toEqual([...INGEST_ORIGINS].sort());
  });

  it("rejects an unknown origin at runtime rather than defaulting", () => {
    expect(() =>
      resolveIngestMetadata({
        origin: "not-an-origin" as IngestOrigin,
        derived: meta("lf"),
        existing: meta("unknown"),
      }),
    ).toThrow(/unknown ingest origin/i);
  });
});

describe("resolveIngestMetadata — per-origin precedence", () => {
  it("disk-open derives from the disk text", () => {
    expect(
      resolveIngestMetadata({
        origin: "disk-open",
        derived: meta("crlf", "backslash"),
        existing: meta("lf", "twoSpaces"),
      }),
    ).toEqual(meta("crlf", "backslash"));
  });

  it("crash-recovery derives from the snapshot body", () => {
    expect(
      resolveIngestMetadata({
        origin: "crash-recovery",
        derived: meta("crlf"),
        existing: meta("lf"),
      }),
    ).toEqual(meta("crlf"));
  });

  // THE regression this item exists for. A hot-exit snapshot stores a CRLF
  // document whose body was canonicalised to LF before persisting. Deriving
  // from that body answers "lf" and the next `preserve` save silently rewrites
  // the user's file to the wrong convention.
  it("hot-exit-restore keeps persisted crlf even though the body is LF", () => {
    expect(
      resolveIngestMetadata({
        origin: "hot-exit-restore",
        derived: meta("lf"),
        existing: meta("unknown"),
        persisted: meta("crlf"),
      }).lineEnding,
    ).toBe("crlf");
  });

  it("hot-exit-restore derives when the persisted value is unknown", () => {
    expect(
      resolveIngestMetadata({
        origin: "hot-exit-restore",
        derived: meta("crlf"),
        existing: meta("unknown"),
        persisted: meta("unknown"),
      }).lineEnding,
    ).toBe("crlf");
  });

  it("hot-exit-restore derives when nothing was persisted at all", () => {
    expect(
      resolveIngestMetadata({
        origin: "hot-exit-restore",
        derived: meta("crlf"),
        existing: meta("unknown"),
      }).lineEnding,
    ).toBe("crlf");
  });

  // Per FIELD, not per record: a snapshot can carry a known lineEnding and an
  // unknown hardBreakStyle. Treating the record as one unit would throw away
  // the known half or resurrect the unknown one.
  it("hot-exit-restore resolves each field independently", () => {
    expect(
      resolveIngestMetadata({
        origin: "hot-exit-restore",
        derived: meta("lf", "twoSpaces"),
        existing: meta("unknown"),
        persisted: meta("crlf", "unknown"),
      }),
    ).toEqual(meta("crlf", "twoSpaces"));
  });

  // The two fields are NOT symmetric. Canonicalisation erases the line ending,
  // so only the snapshot remembers it. It does not erase the hard-break
  // convention — detectHardBreakStyle normalises EOLs before scanning — so the
  // body is the better source and a stale snapshot must not override it.
  it("hot-exit-restore DERIVES hardBreakStyle even when a value was persisted", () => {
    expect(
      resolveIngestMetadata({
        origin: "hot-exit-restore",
        derived: meta("lf", "backslash"),
        existing: meta("unknown"),
        persisted: meta("crlf", "twoSpaces"),
      }),
    ).toEqual(meta("crlf", "backslash"));
  });

  it('does not let a persisted "mixed" outlive the body it described', () => {
    // The concrete loss: resolveHardBreakStyle maps "mixed" to "twoSpaces" on a
    // `preserve` save, so preferring a stale "mixed" over a body that is now
    // backslash-only rewrites every hard break in the file.
    expect(
      resolveIngestMetadata({
        origin: "hot-exit-restore",
        derived: meta("lf", "backslash"),
        existing: meta("unknown"),
        persisted: meta("lf", "mixed"),
      }).hardBreakStyle,
    ).toBe("backslash");
  });

  it.each(["mcp-write"] as const)(
    "%s does not redefine the document's disk convention",
    (origin) => {
      expect(
        resolveIngestMetadata({
          origin,
          derived: meta("crlf", "backslash"),
          existing: meta("lf", "twoSpaces"),
        }),
      ).toEqual(meta("lf", "twoSpaces"));
    },
  );

  it("mcp-write leaves an unknown document unknown rather than adopting the payload", () => {
    // A tool writing CRLF into a brand-new buffer must not decide that the
    // document is a CRLF document — nothing has been read from or written to
    // disk yet, so there is no convention to preserve.
    expect(
      resolveIngestMetadata({
        origin: "mcp-write",
        derived: meta("crlf"),
        existing: meta("unknown"),
      }).lineEnding,
    ).toBe("unknown");
  });
});
