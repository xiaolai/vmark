// @vitest-environment node
// WI-3.1 — messageOf must survive the CommandError migration.
//
// The coherence commands these services call now reject with a TYPED error
// (`{code, message, i18nKey?, detail?}`) instead of a bare string. A typed
// error is a plain object, not an `Error`, so the old
// `error instanceof Error ? error.message : String(error)` fell through to
// `String(object)` — which renders as "[object Object]".
//
// That string is not thrown away: `breakdownRefresh` and `breakdownEdgeService`
// feed it to `useBreakdownStore.setError`, i.e. straight to the user. Rule 50
// names this exact failure and says to use `commandErrorMessage` at any
// boundary that can receive a typed rejection.

import { describe, expect, it } from "vitest";

import { messageOf } from "./breakdownShared";

describe("messageOf", () => {
  it("reads the message out of a typed CommandError rejection", () => {
    // The shape Rust's CommandError serializes to.
    const typed = {
      code: "unsupported",
      message:
        "ledger contains 1 entry in a newer format this build cannot read",
    };
    expect(messageOf(typed)).toBe(
      "ledger contains 1 entry in a newer format this build cannot read",
    );
    expect(messageOf(typed)).not.toContain("[object Object]");
  });

  it("keeps working for the legacy string rejection", () => {
    // The migration is incremental — commands still on Result<T, String> reject
    // with a bare string, and those must not regress while the ratchet runs down.
    expect(messageOf("no such edge: abc#0")).toBe("no such edge: abc#0");
  });

  it("keeps working for a real Error", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
  });

  it("never returns the useless object stringification for any object", () => {
    // A defensive case: even an object that is NOT a CommandError must not
    // reach the user as "[object Object]".
    expect(messageOf({ unexpected: true })).not.toBe("[object Object]");
  });
});
