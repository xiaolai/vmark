// WI-2.5 / R5 — browser approval store: standing grants + pending approvals
import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserApprovalStore } from "./browserApprovalStore";

const URL = "https://blog.example.com/wp-admin/post-new.php";

function reset() {
  useBrowserApprovalStore.setState({ grants: [], pending: [] });
}
beforeEach(reset);

describe("decide", () => {
  it("needs approval with no grants", () => {
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("needs-approval");
  });

  it("allows after a matching standing grant", () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("allowed");
  });

  it("denies upload regardless of grants (WI-1.7)", () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["upload"]);
    expect(useBrowserApprovalStore.getState().decide(URL, "upload")).toBe("denied");
  });

  it("revoke removes access", () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    useBrowserApprovalStore.getState().revoke("https://blog.example.com");
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("needs-approval");
  });
});

describe("pending approval flow", () => {
  it("requestApproval adds a pending entry keyed by id", () => {
    useBrowserApprovalStore.getState().requestApproval("req1", URL, "click");
    const pending = useBrowserApprovalStore.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: "req1", targetUrl: URL, operation: "click" });
  });

  it("resolve('once') removes the pending but grants nothing standing", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click");
    s.resolveApproval("req1", "once");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    // A later request still needs approval — nothing was remembered.
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("needs-approval");
  });

  it("resolve('remember') grants the operation on the target's origin", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click");
    s.resolveApproval("req1", "remember");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    // Future clicks on that origin are now allowed (any path).
    expect(
      useBrowserApprovalStore.getState().decide("https://blog.example.com/other", "click"),
    ).toBe("allowed");
  });

  it("resolve('deny') removes the pending and grants nothing", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click");
    s.resolveApproval("req1", "deny");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("needs-approval");
  });

  it("resolving an unknown id is a no-op", () => {
    expect(() => useBrowserApprovalStore.getState().resolveApproval("nope", "once")).not.toThrow();
  });

  it("ignores a duplicate request id (one id → one authorizable action)", () => {
    // Resolving picked the FIRST match but dropped EVERY entry with that id —
    // authorizing one action while silently discarding the other.
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click");
    s.requestApproval("req1", "https://evil.example/", "type");
    const pending = useBrowserApprovalStore.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ targetUrl: URL, operation: "click" });

    useBrowserApprovalStore.getState().resolveApproval("req1", "remember");
    // Only the first request's origin+operation was remembered.
    expect(useBrowserApprovalStore.getState().decide("https://evil.example/x", "type")).toBe(
      "needs-approval",
    );
  });

  it("resolve('remember') lands the grant and the removal in ONE update", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click");
    const seen: { grants: number; pending: number }[] = [];
    const un = useBrowserApprovalStore.subscribe((st) =>
      seen.push({ grants: st.grants.length, pending: st.pending.length }),
    );
    useBrowserApprovalStore.getState().resolveApproval("req1", "remember");
    un();
    // No intermediate state where the grant exists while the request is still pending.
    expect(seen).toEqual([{ grants: 1, pending: 0 }]);
  });

  it("does not queue an approval for an unknown operation", () => {
    useBrowserApprovalStore.getState().requestApproval("req1", URL, "scroll");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
  });
});

describe("operation vocabulary (an unknown operation can never become authority)", () => {
  it("denies an operation outside the known set", () => {
    // The act tool maps every non-"type" operation to a CLICK script, so an
    // unknown operation that reached "allowed" would click under a bogus label.
    expect(useBrowserApprovalStore.getState().decide(URL, "scroll")).toBe("denied");
    expect(useBrowserApprovalStore.getState().decide(URL, "")).toBe("denied");
  });

  it("refuses to grant an unknown operation", () => {
    expect(useBrowserApprovalStore.getState().grant("https://blog.example.com", ["scroll"])).toBe(
      false,
    );
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
    expect(useBrowserApprovalStore.getState().decide(URL, "scroll")).toBe("denied");
  });

  it("refuses to grant a never-automatable operation (upload)", () => {
    expect(useBrowserApprovalStore.getState().grant("https://blog.example.com", ["upload"])).toBe(
      false,
    );
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
  });

  it("keeps the valid operations when a grant mixes valid and invalid ones", () => {
    expect(
      useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click", "upload"]),
    ).toBe(false);
    // Fail closed: a grant the user did not fully understand is not partially applied.
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
  });
});

describe("grant validation", () => {
  it("refuses a malformed origin pattern (never mirror garbage to the driver)", () => {
    for (const bad of ["", "  ", "not-a-url", "https://*", "https://ex.com/path", "ftp://ex.com"]) {
      expect(useBrowserApprovalStore.getState().grant(bad, ["click"])).toBe(false);
    }
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
  });

  it("refuses an empty operation list (an authority-free grant is a mistake)", () => {
    expect(useBrowserApprovalStore.getState().grant("https://blog.example.com", [])).toBe(false);
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
  });

  it("accepts a well-formed grant", () => {
    expect(
      useBrowserApprovalStore.getState().grant("https://*.example.com", ["read", "click"]),
    ).toBe(true);
    expect(useBrowserApprovalStore.getState().decide("https://blog.example.com/x", "click")).toBe(
      "allowed",
    );
  });
});
