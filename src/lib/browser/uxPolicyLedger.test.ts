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
    expect([...PENDING_SURFACES].sort()).toEqual(
      ["confirm", "download", "prompt", "window-open"].sort(),
    );
  });

  it("the known window-open divergence is explicit, not silent (was: matrix said new-tab, native blocks)", () => {
    expect(UX_LEDGER["window-open"].state).toBe("pending");
  });
});
