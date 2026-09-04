// @vitest-environment node
// WI-2.6 / R5 — operation-based approval + scoped standing grants
import { describe, it, expect } from "vitest";
import { decideApproval, addGrant, revokeOrigin, type StandingGrant } from "./grants";

const URL = "https://blog.example.com/wp-admin/post-new.php";

describe("decideApproval", () => {
  it("needs approval when there are no grants", () => {
    expect(decideApproval(URL, "click", [])).toBe("needs-approval");
  });

  it("allows an operation covered by a matching-origin grant", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://blog.example.com", operations: ["read", "click"] },
    ];
    expect(decideApproval(URL, "click", grants)).toBe("allowed");
    expect(decideApproval(URL, "read", grants)).toBe("allowed");
  });

  it("needs approval for an operation the grant does not list", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://blog.example.com", operations: ["read"] },
    ];
    expect(decideApproval(URL, "style", grants)).toBe("needs-approval");
  });

  it("needs approval when the grant is for a different origin", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://other.example.org", operations: ["click"] },
    ];
    expect(decideApproval(URL, "click", grants)).toBe("needs-approval");
  });

  it("honors a subdomain-wildcard grant via the origin guard", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://*.example.com", operations: ["click"] },
    ];
    expect(decideApproval(URL, "click", grants)).toBe("allowed");
  });

  it("DENIES upload regardless of any grant (the AI may never choose a file — WI-1.7)", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://blog.example.com", operations: ["upload", "click"] },
    ];
    expect(decideApproval(URL, "upload", grants)).toBe("denied");
  });

  it("can allow an explicitly-granted write operation (scoped standing grant)", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://blog.example.com", operations: ["style"] },
    ];
    expect(decideApproval(URL, "style", grants)).toBe("allowed");
  });

  it.each([["Upload"], ["UPLOAD"], [" upload"], ["exfiltrate"], [""]])(
    "DENIES the unknown/case-variant operation %j even when a grant lists it (fail closed)",
    (operation) => {
      const grants: StandingGrant[] = [
        { originPattern: "https://blog.example.com", operations: [operation, "click"] },
      ];
      expect(decideApproval(URL, operation, grants)).toBe("denied");
    },
  );
});

describe("addGrant", () => {
  it("adds a new grant", () => {
    const out = addGrant([], { originPattern: "https://a.test", operations: ["read"] });
    expect(out).toEqual([{ originPattern: "https://a.test", operations: ["read"] }]);
  });

  it("unions operations for an existing origin pattern (deduped, no duplicate entry)", () => {
    const out = addGrant(
      [{ originPattern: "https://a.test", operations: ["read"] }],
      { originPattern: "https://a.test", operations: ["click", "read"] },
    );
    expect(out).toHaveLength(1);
    expect([...out[0].operations].sort()).toEqual(["click", "read"]);
  });

  it("does not mutate the input array", () => {
    const input: StandingGrant[] = [{ originPattern: "https://a.test", operations: ["read"] }];
    addGrant(input, { originPattern: "https://b.test", operations: ["click"] });
    expect(input).toHaveLength(1);
  });

  it.each([
    ["https://A.TEST", "case variant"],
    ["https://a.test/", "trailing slash"],
    ["https://a.test:443", "explicit default port"],
  ])("merges %s (%s) into the canonically identical existing grant", (alias) => {
    const out = addGrant([{ originPattern: "https://a.test", operations: ["read"] }], {
      originPattern: alias,
      operations: ["click"],
    });
    expect(out).toHaveLength(1);
    expect([...out[0].operations].sort()).toEqual(["click", "read"]);
  });

  it("keeps a wildcard pattern distinct from its apex", () => {
    const out = addGrant([{ originPattern: "https://a.test", operations: ["read"] }], {
      originPattern: "https://*.a.test",
      operations: ["read"],
    });
    expect(out).toHaveLength(2);
  });

  it("rejects an invalid origin pattern rather than storing an inert grant", () => {
    const grants: StandingGrant[] = [{ originPattern: "https://a.test", operations: ["read"] }];
    expect(addGrant(grants, { originPattern: "not-a-url", operations: ["read"] })).toEqual(grants);
    expect(addGrant(grants, { originPattern: "https://a.test/path", operations: ["read"] })).toEqual(
      grants,
    );
  });

  it("filters forbidden and unknown operations, and never stores an empty grant", () => {
    const out = addGrant([], {
      originPattern: "https://a.test",
      operations: ["read", "upload", "Click", "read"],
    });
    expect(out).toEqual([{ originPattern: "https://a.test", operations: ["read"] }]);
    // Nothing survivable left → no grant at all (an empty grant is misleading state).
    expect(addGrant([], { originPattern: "https://a.test", operations: ["upload"] })).toEqual([]);
    expect(addGrant([], { originPattern: "https://a.test", operations: [] })).toEqual([]);
  });

  it("SECURITY: snapshots the origin pattern once — a getter cannot widen it after validation", () => {
    let reads = 0;
    const sneaky = {
      get originPattern() {
        // Narrow origin to the validator, broader origin when stored — the classic
        // validation-to-use bypass. addGrant must read this exactly once.
        return reads++ === 0 ? "https://narrow.example" : "https://*.example";
      },
      operations: ["read"],
    } as unknown as StandingGrant;
    const out = addGrant([], sneaky);
    expect(out).toHaveLength(1);
    expect(out[0].originPattern).toBe("https://narrow.example");
  });

  it("collapses pre-existing duplicate entries for one origin into a single grant", () => {
    const out = addGrant(
      [
        { originPattern: "https://a.test", operations: ["read"] },
        { originPattern: "https://A.test/", operations: ["type"] },
      ],
      { originPattern: "https://a.test", operations: ["click"] },
    );
    expect(out).toHaveLength(1);
    expect([...out[0].operations].sort()).toEqual(["click", "read", "type"]);
  });
});

describe("revokeOrigin", () => {
  it("removes grants for the given origin pattern", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://a.test", operations: ["read"] },
      { originPattern: "https://b.test", operations: ["click"] },
    ];
    const out = revokeOrigin(grants, "https://a.test");
    expect(out).toEqual([{ originPattern: "https://b.test", operations: ["click"] }]);
  });

  it.each([["https://A.TEST"], ["https://a.test/"], ["https://a.test:443"]])(
    "revokes by canonical identity, so the alias %s leaves no equivalent grant behind",
    (alias) => {
      const grants: StandingGrant[] = [{ originPattern: "https://a.test", operations: ["read"] }];
      expect(revokeOrigin(grants, alias)).toEqual([]);
    },
  );

  it("still revokes legacy state whose pattern the guard cannot parse (exact string)", () => {
    const grants: StandingGrant[] = [
      { originPattern: "not-a-url", operations: ["read"] },
      { originPattern: "https://b.test", operations: ["click"] },
    ];
    expect(revokeOrigin(grants, "not-a-url")).toEqual([
      { originPattern: "https://b.test", operations: ["click"] },
    ]);
  });

  it("does not revoke the apex when revoking its wildcard", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://a.test", operations: ["read"] },
      { originPattern: "https://*.a.test", operations: ["read"] },
    ];
    expect(revokeOrigin(grants, "https://*.a.test")).toEqual([
      { originPattern: "https://a.test", operations: ["read"] },
    ]);
  });
});

// ADR-A5/A6 — `eval` (execute_js) is KNOWN + one-shot-able but NEVER grantable.
describe("eval is never grantable (per-call approval only)", () => {
  it("needs approval even when a grant tries to carry eval", () => {
    // A grant listing eval must not authorize it — every call is per-call.
    const grants: StandingGrant[] = [
      { originPattern: "https://blog.example.com", operations: ["read", "eval"] },
    ];
    expect(decideApproval(URL, "eval", grants)).toBe("needs-approval");
    // read still works from the same grant.
    expect(decideApproval(URL, "read", grants)).toBe("allowed");
  });

  it("strips eval when adding a grant, so it can never be stored", () => {
    const grants = addGrant([], {
      originPattern: "https://blog.example.com",
      operations: ["click", "eval"],
    });
    expect(grants).toHaveLength(1);
    expect(grants[0].operations).toContain("click");
    expect(grants[0].operations).not.toContain("eval");
  });

  it("allows style through a grant (style IS grantable, unlike eval)", () => {
    const grants: StandingGrant[] = [
      { originPattern: "https://blog.example.com", operations: ["style"] },
    ];
    expect(decideApproval(URL, "style", grants)).toBe("allowed");
  });
});

// WI-NB8.1 — the upload prohibition is DERIVED from uxPolicy, making that
// module load-bearing in production rather than a decision record nothing reads.
describe("upload prohibition is sourced from uxPolicy (WI-NB8.1)", () => {
  it("upload is denied outright — never allowed, never grantable", () => {
    expect(decideApproval(URL, "upload", [{ originPattern: "https://blog.example.com", operations: ["upload"] }])).toBe(
      "denied",
    );
  });

  it("upload is stripped from a grant, exactly like eval — it can never be stored", () => {
    const grants = addGrant([], { originPattern: "https://blog.example.com", operations: ["click", "upload"] });
    expect(grants).toHaveLength(1);
    expect(grants[0].operations).toContain("click");
    expect(grants[0].operations).not.toContain("upload");
  });
});

// Audit 2026-09-03 R11 / A-05 / #13 — one vocabulary, honest contracts.
describe("operation vocabulary (audit 2026-09-03)", () => {
  it("publish is gone: no consumer ever existed, so it is unknown and denied", async () => {
    const { isBrowserOperation, isGrantableOperation, isApprovableOperation, BROWSER_OPERATIONS } =
      await import("./grants");
    expect(BROWSER_OPERATIONS).not.toContain("publish");
    expect(isBrowserOperation("publish")).toBe(false);
    expect(decideApproval("https://blog.example.com/", "publish", [])).toBe("denied");
    expect(isGrantableOperation("publish")).toBe(false);
    expect(isApprovableOperation("publish")).toBe(false);
  });

  it("upload is known, never approvable, never grantable", async () => {
    const { isBrowserOperation, isGrantableOperation, isApprovableOperation } = await import("./grants");
    expect(isBrowserOperation("upload")).toBe(true);
    expect(isApprovableOperation("upload")).toBe(false);
    expect(isGrantableOperation("upload")).toBe(false);
  });

  it("per-call-only operations are approvable but not grantable", async () => {
    const { isGrantableOperation, isApprovableOperation } = await import("./grants");
    for (const op of ["eval", "session", "record"]) {
      expect(isApprovableOperation(op)).toBe(true);
      expect(isGrantableOperation(op)).toBe(false);
    }
    for (const op of ["click", "type", "scroll", "key", "style", "navigate", "read", "attach"]) {
      expect(isGrantableOperation(op)).toBe(true);
    }
  });
});
