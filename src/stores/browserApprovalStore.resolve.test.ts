// @vitest-environment node
// Audit 2026-09-03 round 3 (#150) — the non-attach resolve transition, split into the
// three things it does: a profile-OPEN approval, a standing grant, a one-shot. Each is
// pure and tested alone; `resolveNonAttach` composes them and drops the prompt.
import { describe, expect, it } from "vitest";
import { MAX_ONE_SHOTS, MAX_PENDING_APPROVALS } from "./browserApprovalStore.constants";
import {
  mintOneShot,
  rememberStandingGrant,
  resolveNonAttach,
  resolveProfileOpen,
} from "./browserApprovalStore.resolve";
import type { OneShotApproval, PendingApproval, ProfileOpenApproval } from "./browserApprovalStore.types";

const PATTERN = "https://site.example.com";

function request(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "req-1",
    targetUrl: "https://site.example.com/page",
    operation: "click",
    tabId: "tab-1",
    generation: 3,
    target: { role: "button", name: "Publish" },
    ...overrides,
  };
}

/** A payload-binding prompt (`eval`/`style`): it binds a script, not an element. */
function scriptedRequest(script: string): PendingApproval {
  return { id: "req-1", targetUrl: "https://site.example.com/page", operation: "eval", tabId: "tab-1", generation: 3, script };
}

function shot(n: number): OneShotApproval {
  return { originPattern: `https://s${n}.example`, operation: "click", tabId: "tab-1", generation: 1 };
}

describe("resolveProfileOpen", () => {
  const req = request({ profile: "work", operation: "navigate" });

  it("mints a single-use (profile, origin) approval on Allow once", () => {
    expect(resolveProfileOpen([], req, "once", PATTERN)).toEqual([{ profile: "work", originPattern: PATTERN }]);
  });

  it("never mints a standing grant for a profile open, and mints nothing on deny", () => {
    const opens: ProfileOpenApproval[] = [];
    expect(resolveProfileOpen(opens, req, "remember", PATTERN)).toBe(opens);
    expect(resolveProfileOpen(opens, req, "deny", PATTERN)).toBe(opens);
  });

  it("fails closed for an opaque origin (no pattern)", () => {
    const opens: ProfileOpenApproval[] = [];
    expect(resolveProfileOpen(opens, req, "once", null)).toBe(opens);
  });

  it("de-duplicates an approval already held for the same (profile, origin)", () => {
    const opens = [{ profile: "work", originPattern: PATTERN }];
    expect(resolveProfileOpen(opens, req, "once", PATTERN)).toBe(opens);
    // A different profile on the same origin is a different approval.
    expect(resolveProfileOpen(opens, request({ profile: "home" }), "once", PATTERN)).toHaveLength(2);
  });

  it("is capped at MAX_PENDING_APPROVALS, mirroring the driver", () => {
    const full = Array.from({ length: MAX_PENDING_APPROVALS }, (_, i) => ({ profile: `p${i}`, originPattern: PATTERN }));
    expect(resolveProfileOpen(full, req, "once", PATTERN)).toBe(full);
  });
});

describe("rememberStandingGrant", () => {
  it("promotes the request's operation to a standing grant on Remember", () => {
    expect(rememberStandingGrant([], request(), "remember", PATTERN)).toEqual([
      { originPattern: PATTERN, operations: ["click"] },
    ]);
  });

  it("changes nothing on Allow once or Deny, and for an opaque origin", () => {
    const grants = [{ originPattern: "https://other.example", operations: ["read"] }];
    expect(rememberStandingGrant(grants, request(), "once", PATTERN)).toBe(grants);
    expect(rememberStandingGrant(grants, request(), "deny", PATTERN)).toBe(grants);
    expect(rememberStandingGrant(grants, request(), "remember", null)).toBe(grants);
  });
});

describe("mintOneShot", () => {
  it("mints a one-shot bound to the origin, operation, tab, generation and target on Allow once", () => {
    expect(mintOneShot([], request(), "once", PATTERN)).toEqual([
      {
        originPattern: PATTERN,
        operation: "click",
        tabId: "tab-1",
        generation: 3,
        target: { role: "button", name: "Publish" },
      },
    ]);
  });

  it("binds the exact script for payload operations, and carries the runId only when the prompt had one", () => {
    const [scripted] = mintOneShot([], scriptedRequest("1+1"), "once", PATTERN);
    expect(scripted).toEqual({ originPattern: PATTERN, operation: "eval", tabId: "tab-1", generation: 3, script: "1+1" });
    expect(scripted !== undefined && "runId" in scripted).toBe(false);

    const [runScoped] = mintOneShot([], request({ runId: "run-7" }), "once", PATTERN);
    expect(runScoped).toMatchObject({ runId: "run-7" });
  });

  it("changes nothing on Remember or Deny, and for an opaque origin", () => {
    const shots = [shot(1)];
    expect(mintOneShot(shots, request(), "remember", PATTERN)).toBe(shots);
    expect(mintOneShot(shots, request(), "deny", PATTERN)).toBe(shots);
    expect(mintOneShot(shots, request(), "once", null)).toBe(shots);
  });

  it("evicts the OLDEST unspent one-shot at the cap, never the newest (#151)", () => {
    const full = Array.from({ length: MAX_ONE_SHOTS }, (_, i) => shot(i));
    const next = mintOneShot(full, request(), "once", PATTERN);
    expect(next).toHaveLength(MAX_ONE_SHOTS);
    expect(next[0]).toBe(full[1]);
    expect(next[next.length - 1]).toMatchObject({ originPattern: PATTERN });
    expect(next.some((s) => s === full[0])).toBe(false);
  });

  it("below the cap, appends without evicting", () => {
    const some = [shot(1), shot(2)];
    const next = mintOneShot(some, request(), "once", PATTERN);
    expect(next.slice(0, 2)).toEqual(some);
    expect(next).toHaveLength(3);
  });
});

describe("resolveNonAttach", () => {
  const state = {
    grants: [],
    pending: [request(), request({ id: "req-2" })],
    oneShots: [shot(1)],
    profileOpens: [],
  };

  it("drops exactly the resolved prompt", () => {
    const next = resolveNonAttach(state, request(), "deny", PATTERN);
    expect(next.pending?.map((p) => p.id)).toEqual(["req-2"]);
  });

  it("routes a profile-open prompt to the profile transition and touches no grant or one-shot", () => {
    const next = resolveNonAttach(state, request({ profile: "work" }), "once", PATTERN);
    expect(next).toEqual({
      profileOpens: [{ profile: "work", originPattern: PATTERN }],
      pending: [request({ id: "req-2" })],
    });
  });

  it("routes an ordinary prompt to the grant and one-shot transitions in one update", () => {
    const remembered = resolveNonAttach(state, request(), "remember", PATTERN);
    expect(remembered.grants).toEqual([{ originPattern: PATTERN, operations: ["click"] }]);
    expect(remembered.oneShots).toBe(state.oneShots);
    expect(remembered.pending).toHaveLength(1);

    const once = resolveNonAttach(state, request(), "once", PATTERN);
    expect(once.grants).toBe(state.grants);
    expect(once.oneShots).toHaveLength(2);
    expect(once.pending).toHaveLength(1);
  });

  it("fails closed for an opaque origin: the prompt is dropped and nothing is minted", () => {
    const next = resolveNonAttach(state, request(), "once", null);
    expect(next.grants).toBe(state.grants);
    expect(next.oneShots).toBe(state.oneShots);
    expect(next.pending).toHaveLength(1);
  });
});
