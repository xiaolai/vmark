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
    expect(decideApproval(URL, "publish", grants)).toBe("needs-approval");
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
      { originPattern: "https://blog.example.com", operations: ["publish"] },
    ];
    expect(decideApproval(URL, "publish", grants)).toBe("allowed");
  });
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
});
