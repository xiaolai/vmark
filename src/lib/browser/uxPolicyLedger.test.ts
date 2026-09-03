// @vitest-environment node
// WI-NB8.2 — the two-way conformance identity: every UX_POLICY surface has a
// ledger entry and vice versa, so a new/removed surface or a retint cannot land
// without a conformance decision. The pending list is shrink-only (an
// identity-ratcheted allowlist, like shell-slots): closing a gap is fine, adding
// one silently is not.
import { describe, it, expect } from "vitest";
import { UX_SURFACES } from "./uxPolicy";
import { UX_LEDGER, PENDING_SURFACES } from "./uxPolicyLedger";

describe("uxPolicy conformance ledger", () => {
  it("covers exactly the UX_POLICY surfaces (two-way identity)", () => {
    expect([...Object.keys(UX_LEDGER)].sort()).toEqual([...UX_SURFACES].sort());
  });

  it("every pending entry carries a non-empty reason", () => {
    for (const s of UX_SURFACES) {
      const entry = UX_LEDGER[s];
      if (entry.state === "pending") {
        expect(entry.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("the pending set is EXACTLY this list — shrink-only, no silent growth", () => {
    // Freeze the known gaps. Closing one (flip to `conforms`) is a passing
    // change that shrinks this; adding a new gap fails until it is recorded here
    // deliberately.
    //
    // 2026-09-03: the list GREW by six and shrank by one, deliberately. `confirm`
    // was pending while confirm() had shipped; `basic-auth`, `find`, `zoom` and the
    // four permission prompts were recorded as conforming with no implementation
    // behind them. A shrink-only ratchet protects true records; those were false
    // records, and correcting a false `conforms` to an honest `pending` is the
    // ledger doing its job, not the gap growing.
    expect([...PENDING_SURFACES].sort()).toEqual(
      [
        "basic-auth",
        "download",
        "find",
        "permission-camera",
        "permission-geolocation",
        "permission-mic",
        "permission-notifications",
        "prompt",
        "window-open",
        "zoom",
      ].sort(),
    );
  });

  it("confirm() is recorded as shipped — it is surfaced and answered", () => {
    expect(UX_LEDGER.confirm.state).toBe("conforms");
  });

  it("the known window-open divergence is explicit, not silent (was: matrix said new-tab, native blocks)", () => {
    expect(UX_LEDGER["window-open"].state).toBe("pending");
  });
});
