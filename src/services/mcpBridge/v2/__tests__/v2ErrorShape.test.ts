// @vitest-environment node
// The V2 error envelope's shape is checked by the type checker: only INTERNAL
// may say the edit was `applied`, an applied INTERNAL always says whether it
// is `durable`, and `durable` never appears without `applied`. Each
// `@ts-expect-error` below is an envelope the type must reject
// (`pnpm lint:test-types` fails if one is accepted).
import { describe, expect, it } from "vitest";
import { v2ErrorString, type V2Error } from "../types";

describe("V2Error", () => {
  it("accepts the envelopes the bridge sends", () => {
    const accepted: V2Error[] = [
      { error: "STALE", message: "changed", current_revision: "r2" },
      { error: "ABORTED", reason: "edited", message: "edited" },
      { error: "INTERNAL", message: "failed" },
      { error: "INTERNAL", message: "failed after applying", applied: true, durable: false, current_revision: "r3" },
    ];
    expect(accepted.map((e) => JSON.parse(v2ErrorString(e)).error)).toEqual(["STALE", "ABORTED", "INTERNAL", "INTERNAL"]);
  });

  it("rejects applied or durable outside an applied INTERNAL", () => {
    const rejected: V2Error[] = [
      // @ts-expect-error — only INTERNAL can report an applied edit
      { error: "STALE", message: "changed", applied: true, durable: true },
      // @ts-expect-error — only INTERNAL can report an applied edit
      { error: "INVALID_PATH", message: "bad", applied: true, durable: false },
      // @ts-expect-error — an applied INTERNAL says whether it is durable
      { error: "INTERNAL", message: "failed", applied: true },
      // @ts-expect-error — durable without applied
      { error: "INTERNAL", message: "failed", durable: true },
      // @ts-expect-error — ABORTED changed nothing
      { error: "ABORTED", reason: "edited", message: "edited", applied: true, durable: true },
    ];
    expect(rejected).toHaveLength(5);
  });
});
