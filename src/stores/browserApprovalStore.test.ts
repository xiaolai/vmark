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
});
