/**
 * Pure unit tests for the transfer line-metadata helpers.
 *
 * `src/utils/` is leaf-pure (ADR-013), so the store round-trip that motivates
 * this module lives in `stores/documentStore/__tests__/transferRoundTrip.test.ts`
 * — it needs the document store and the save pipeline, which a util may not
 * import. `pnpm lint:deps` enforces the split.
 *
 * @coordinates-with utils/transferLineMetadata.ts
 * @module utils/transferLineMetadata.test
 */
import { describe, it, expect } from "vitest";
import {
  collectTransferLineMetadata,
  applyTransferLineMetadata,
} from "./transferLineMetadata";

describe("collectTransferLineMetadata", () => {
  it("omits unknown values rather than sending them", () => {
    // Absent and "unknown" mean the same thing to the receiver; omitting keeps
    // an old build's payload and a new one indistinguishable when there is
    // nothing to say.
    const meta = collectTransferLineMetadata({
      lineEnding: "unknown",
      hardBreakStyle: "unknown",
      hasBom: false,
      lastDiskContent: "",
    });
    expect(meta).toEqual({});
  });

  it("sends every field the document actually knows", () => {
    expect(
      collectTransferLineMetadata({
        lineEnding: "crlf",
        hardBreakStyle: "backslash",
        hasBom: true,
        lastDiskContent: "raw\r\n",
      })
    ).toEqual({
      lineEnding: "crlf",
      hardBreakStyle: "backslash",
      hasBom: true,
      lastDiskContent: "raw\r\n",
    });
  });
});

describe("applyTransferLineMetadata — backward compatibility", () => {
  it("an OLD build's payload (no metadata) yields no patch", () => {
    // The receiver then falls back to what it derived, which is what every
    // payload got before this existed. A cross-version move must not crash or
    // overwrite good values with undefined.
    expect(applyTransferLineMetadata(undefined)).toEqual({});
    expect(applyTransferLineMetadata({})).toEqual({});
  });

  it("applies hasBom: false explicitly — absent and false are different", () => {
    expect(applyTransferLineMetadata({ hasBom: false })).toEqual({ hasBom: false });
  });
});
