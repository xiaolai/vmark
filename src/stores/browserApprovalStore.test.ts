// @vitest-environment node
// WI-2.5 / R5 — browser approval store: standing grants + pending approvals
// WI-S0.8 — dismissForNavigation: authority and prompts lapse when the page changes
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MAX_ONE_SHOTS } from "./browserApprovalStore.constants";
import { useBrowserApprovalStore } from "./browserApprovalStore";
import { __setAttachInvoker } from "@/services/browser/humanTabAttach";

const URL = "https://blog.example.com/wp-admin/post-new.php";

function reset() {
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
}
beforeEach(reset);

describe("dismissForNavigation (R7a)", () => {
  it("drops a pending prompt for the tab that navigated", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("r1", URL, "click", { role: "button", name: "Publish" }, "tab-1", 1);
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);

    // The page navigated away — the prompt described a page that no longer exists.
    // Answering it would authorize the action against whatever loaded instead.
    useBrowserApprovalStore.getState().dismissForNavigation("tab-1");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
  });

  it("drops an unspent one-shot for the tab that navigated", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("r1", URL, "click", { role: "button", name: "Publish" }, "tab-1", 1);
    s.resolveApproval("r1", "once");
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(1);

    useBrowserApprovalStore.getState().dismissForNavigation("tab-1");
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(0);
    // And it really cannot be spent afterwards.
    expect(
      useBrowserApprovalStore
        .getState()
        .consumeOneShot(URL, "click", { role: "button", name: "Publish" }, "tab-1"),
    ).toBe(false);
  });

  it("leaves other tabs' prompts and one-shots untouched", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("r1", URL, "click", { role: "button", name: "Publish" }, "tab-1", 1);
    s.requestApproval("r2", URL, "click", { role: "button", name: "Publish" }, "tab-2", 1);
    s.resolveApproval("r2", "once");

    useBrowserApprovalStore.getState().dismissForNavigation("tab-1");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0); // r1 gone
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(1); // tab-2's survives
    expect(useBrowserApprovalStore.getState().oneShots[0].tabId).toBe("tab-2");
  });

  it("does NOT revoke standing grants (the user chose those deliberately)", () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    useBrowserApprovalStore.getState().dismissForNavigation("tab-1");
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("allowed");
  });
});

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
    useBrowserApprovalStore.getState().requestApproval("req1", URL, "click", undefined, "tab-1", 1);
    const pending = useBrowserApprovalStore.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: "req1", targetUrl: URL, operation: "click" });
  });

  it("resolve('once') removes the pending but grants nothing standing", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click", undefined, "tab-1", 1);
    s.resolveApproval("req1", "once");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    // A later request still needs approval — nothing was remembered.
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("needs-approval");
  });

  it("resolve('remember') grants the operation on the target's origin", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click", undefined, "tab-1", 1);
    s.resolveApproval("req1", "remember");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    // Future clicks on that origin are now allowed (any path).
    expect(
      useBrowserApprovalStore.getState().decide("https://blog.example.com/other", "click"),
    ).toBe("allowed");
  });

  it("resolve('deny') removes the pending and grants nothing", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click", undefined, "tab-1", 1);
    s.resolveApproval("req1", "deny");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    expect(useBrowserApprovalStore.getState().decide(URL, "click")).toBe("needs-approval");
  });

  it("a Deny while the attach is in flight is ignored like any other click (#153)", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "attach", undefined, "tab-1", 1);
    useBrowserApprovalStore.setState({ resolving: ["req1"] });
    useBrowserApprovalStore.getState().resolveApproval("req1", "deny");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
    useBrowserApprovalStore.setState({ resolving: [] });
  });

  it("minting past MAX_ONE_SHOTS evicts the oldest one-shot, never the newest (#151)", () => {
    for (let i = 0; i < MAX_ONE_SHOTS + 1; i++) {
      const id = `cap-${i}`;
      useBrowserApprovalStore.getState().requestApproval(id, `https://cap${i}.example/p`, "click", undefined, "tab-1", 1);
      useBrowserApprovalStore.getState().resolveApproval(id, "once");
    }
    const shots = useBrowserApprovalStore.getState().oneShots;
    expect(shots).toHaveLength(MAX_ONE_SHOTS);
    expect(shots.some((s) => s.originPattern === "https://cap0.example")).toBe(false);
    expect(shots.some((s) => s.originPattern === `https://cap${MAX_ONE_SHOTS}.example`)).toBe(true);
  });

  it("resolving an unknown id is a no-op", () => {
    expect(() => useBrowserApprovalStore.getState().resolveApproval("nope", "once")).not.toThrow();
  });

  it("ignores a duplicate request id (one id → one authorizable action)", () => {
    // Resolving picked the FIRST match but dropped EVERY entry with that id —
    // authorizing one action while silently discarding the other.
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("req1", URL, "click", undefined, "tab-1", 1);
    s.requestApproval("req1", "https://evil.example/", "type", undefined, "tab-1", 1);
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
    s.requestApproval("req1", URL, "click", undefined, "tab-1", 1);
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
    // `frobnicate` is outside the closed vocabulary (unlike scroll/key/style/eval,
    // which are all known operations now).
    useBrowserApprovalStore.getState().requestApproval("req1", URL, "frobnicate", undefined, "tab-1", 1);
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
  });
});

describe("operation vocabulary (an unknown operation can never become authority)", () => {
  it("denies an operation outside the known set", () => {
    // The act tool maps every non-"type" operation to a CLICK script, so an
    // unknown operation that reached "allowed" would click under a bogus label.
    expect(useBrowserApprovalStore.getState().decide(URL, "frobnicate")).toBe("denied");
    expect(useBrowserApprovalStore.getState().decide(URL, "")).toBe("denied");
  });

  it("refuses to grant an unknown operation", () => {
    expect(useBrowserApprovalStore.getState().grant("https://blog.example.com", ["frobnicate"])).toBe(
      false,
    );
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
    expect(useBrowserApprovalStore.getState().decide(URL, "frobnicate")).toBe("denied");
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

// "Allow once" — a one-shot authorization (R5).
//
// Before this, resolveApproval(id, "once") only cleared the request. The AI's
// retry arrives with a NEW request id, so nothing could match it back to the
// user's approval: decide() returned "needs-approval" again, forever. "Allow
// once" authorized nothing at all.
//
// A one-shot is therefore keyed by (origin, operation) — not by request id — and
// is consumed exactly once by the next matching action.
describe("allow-once (one-shot authorization)", () => {
  beforeEach(() => {
    useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  });

  it("authorizes exactly one subsequent action, then expires", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-1", "https://blog.example.com/p", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-1", "once");

    // The retry arrives under a DIFFERENT request id — the one-shot must still match.
    expect(useBrowserApprovalStore.getState().consumeOneShot("https://blog.example.com/p", "click", undefined, "tab-1")).toBe(true);
    // …and it is spent.
    expect(useBrowserApprovalStore.getState().consumeOneShot("https://blog.example.com/p", "click", undefined, "tab-1")).toBe(false);
  });

  it("does not create a standing grant", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-2", "https://blog.example.com", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-2", "once");
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
    // decide() still says needs-approval: a one-shot is not standing authority.
    expect(useBrowserApprovalStore.getState().decide("https://blog.example.com", "click")).toBe("needs-approval");
  });

  it("is scoped to the approved origin", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-3", "https://blog.example.com", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-3", "once");
    expect(useBrowserApprovalStore.getState().consumeOneShot("https://evil.com", "click", undefined, "tab-1")).toBe(false);
    // Unspent for the origin it was granted on.
    expect(useBrowserApprovalStore.getState().consumeOneShot("https://blog.example.com", "click", undefined, "tab-1")).toBe(true);
  });

  it("is scoped to the approved operation", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-4", "https://blog.example.com", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-4", "once");
    expect(useBrowserApprovalStore.getState().consumeOneShot("https://blog.example.com", "type", undefined, "tab-1")).toBe(false);
  });

  it("matches a subdomain no more loosely than a standing grant would", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-5", "https://blog.example.com", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-5", "once");
    // No implicit subdomain wildcarding — same rule as grants.
    expect(useBrowserApprovalStore.getState().consumeOneShot("https://evil.blog.example.com", "click", undefined, "tab-1")).toBe(false);
  });

  it("deny does not leave a one-shot behind", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-6", "https://blog.example.com", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-6", "deny");
    expect(useBrowserApprovalStore.getState().consumeOneShot("https://blog.example.com", "click", undefined, "tab-1")).toBe(false);
  });

  it("remember does not also leave a one-shot behind (no double authorization)", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-7", "https://blog.example.com", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-7", "remember");
    expect(useBrowserApprovalStore.getState().oneShots).toEqual([]);
  });

  it("refuses to mint a one-shot for an opaque origin", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-8", "about:blank", "click", undefined, "tab-1", 1);
    store.resolveApproval("req-8", "once");
    expect(useBrowserApprovalStore.getState().oneShots).toEqual([]);
  });
});

// Target binding — a one-shot approved for "click Publish" must NOT authorize
// "click Delete" on the same origin+operation. The AI controls what it retries
// with, so within the single-action window it could otherwise escalate to a
// different element than the user actually approved.
describe("one-shot target binding", () => {
  beforeEach(() => {
    useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  });

  it("authorizes the exact approved target and nothing else", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-1", "https://blog.example.com/p", "click", {
      role: "button",
      name: "Publish",
    }, "tab-1", 1);
    store.resolveApproval("req-1", "once");

    // A different NAME on the same origin+operation is refused.
    expect(
      useBrowserApprovalStore
        .getState()
        .consumeOneShot("https://blog.example.com/p", "click", { role: "button", name: "Delete" }, "tab-1"),
    ).toBe(false);
    // A different ROLE is refused.
    expect(
      useBrowserApprovalStore
        .getState()
        .consumeOneShot("https://blog.example.com/p", "click", { role: "link", name: "Publish" }, "tab-1"),
    ).toBe(false);
    // The exact approved target is authorized...
    expect(
      useBrowserApprovalStore
        .getState()
        .consumeOneShot("https://blog.example.com/p", "click", { role: "button", name: "Publish" }, "tab-1"),
    ).toBe(true);
    // ...and spent.
    expect(
      useBrowserApprovalStore
        .getState()
        .consumeOneShot("https://blog.example.com/p", "click", { role: "button", name: "Publish" }, "tab-1"),
    ).toBe(false);
  });

  it("a read one-shot (no target) is matched without a target", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-2", "https://blog.example.com", "read", undefined, "tab-1", 1);
    store.resolveApproval("req-2", "once");
    expect(
      useBrowserApprovalStore.getState().consumeOneShot("https://blog.example.com", "read", undefined, "tab-1"),
    ).toBe(true);
  });

  it("a targeted one-shot is not consumed by a target-less call", () => {
    const store = useBrowserApprovalStore.getState();
    store.requestApproval("req-3", "https://blog.example.com", "click", {
      role: "button",
      name: "Publish",
    }, "tab-1", 1);
    store.resolveApproval("req-3", "once");
    // A click with no target descriptor must not spend a target-bound one-shot.
    expect(
      useBrowserApprovalStore.getState().consumeOneShot("https://blog.example.com", "click", undefined, "tab-1"),
    ).toBe(false);
  });
});

// Audit 20260815-163607 #24 — an approved attachment that FAILS must not look
// like one that succeeded. `attachHumanTab` fired `browser_ai_attach` with
// `() => {}` as its rejection handler, and `resolveApproval` had already dropped
// the prompt, so a failed IPC left the user believing they had granted access
// while nothing was attached and nothing was reported.
describe("attach approval failure (audit #24)", () => {
  it("keeps the prompt raised when the attach IPC rejects", async () => {
    __setAttachInvoker(() => Promise.reject(new Error("ipc down")));
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("a1", URL, "attach", undefined, "tab-1", 1);
    s.resolveApproval("a1", "once");

    await vi.waitFor(() => {
      expect(useBrowserApprovalStore.getState().attachments).toHaveLength(0);
      // Still pending — the user can retry or deny, rather than being told nothing.
      expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
    });
  });

  it("records the attachment and clears the prompt when the IPC resolves", async () => {
    __setAttachInvoker(() => Promise.resolve());
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("a2", URL, "attach", undefined, "tab-1", 1);
    s.resolveApproval("a2", "once");

    await vi.waitFor(() => {
      expect(useBrowserApprovalStore.getState().attachments).toHaveLength(1);
      expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    });
  });

  it("denying an attach never calls the IPC and drops the prompt", async () => {
    const calls: number[] = [];
    __setAttachInvoker(() => {
      calls.push(1);
      return Promise.resolve();
    });
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("a3", URL, "attach", undefined, "tab-1", 1);
    s.resolveApproval("a3", "deny");

    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

// Audit 2026-09-03 — #14 (grant() lied), #12 (revokeAll), #17 (generation), A-05.
describe("store contracts (audit 2026-09-03)", () => {
  it("grant() refuses a list with a non-grantable op and stores NOTHING", () => {
    const s = useBrowserApprovalStore.getState();
    expect(s.grant("https://blog.example.com", ["click", "eval"])).toBe(false);
    expect(s.grant("https://blog.example.com", ["upload"])).toBe(false);
    expect(s.grant("https://blog.example.com", ["publish"])).toBe(false);
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
    expect(s.grant("https://blog.example.com", ["click", "type"])).toBe(true);
    expect(useBrowserApprovalStore.getState().grants).toEqual([
      { originPattern: "https://blog.example.com", operations: ["click", "type"] },
    ]);
  });

  it("revokeAll clears every standing grant", () => {
    const s = useBrowserApprovalStore.getState();
    s.grant("https://a.example", ["click"]);
    s.grant("https://b.example", ["read"]);
    useBrowserApprovalStore.getState().revokeAll();
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
  });

  it("an upload prompt is never queued — nothing the user answers could authorize it", () => {
    const s = useBrowserApprovalStore.getState();
    expect(s.requestApproval("u1", URL, "upload", undefined, "tab-1", 1)).toBe("rejected");
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    expect(s.consumeOneShot(URL, "upload", undefined, "tab-1")).toBe(false);
  });

  it("consumeOneShot refuses a shot minted against an older generation when told the current one", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("r1", URL, "click", { role: "button", name: "Publish" }, "tab-1", 3);
    s.resolveApproval("r1", "once");
    const target = { role: "button", name: "Publish" };
    expect(useBrowserApprovalStore.getState().consumeOneShot(URL, "click", target, "tab-1", undefined, 4)).toBe(false);
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(1);
    expect(useBrowserApprovalStore.getState().consumeOneShot(URL, "click", target, "tab-1", undefined, 3)).toBe(true);
  });

  it("a payload-binding request binds the script and carries a display summary", () => {
    const s = useBrowserApprovalStore.getState();
    const script = "return __vmarkType('textbox','Message','hello')";
    s.requestApproval("t1", URL, "type", { role: "textbox", name: "Message" }, "tab-1", 1, script, undefined, 'Text: "hello"');
    const pending = useBrowserApprovalStore.getState().pending[0];
    expect(pending.script).toBe(script);
    expect(pending.payloadSummary).toBe('Text: "hello"');
    s.resolveApproval("t1", "once");
    const shot = useBrowserApprovalStore.getState().oneShots[0];
    expect(shot.script).toBe(script);
    expect((shot as { payloadSummary?: string }).payloadSummary).toBeUndefined();
    // A substituted text is a different script and does not spend the approval.
    const other = "return __vmarkType('textbox','Message','wire $5000')";
    expect(s.consumeOneShot(URL, "type", { role: "textbox", name: "Message" }, "tab-1", other)).toBe(false);
    expect(s.consumeOneShot(URL, "type", { role: "textbox", name: "Message" }, "tab-1", script)).toBe(true);
  });
});

// Audit 2026-09-03 #13 — the store's vocabulary IS the lib's, not a restatement.
describe("operation vocabulary is shared, not copied", () => {
  it("the store helper re-exports lib/browser/approval/grants' KNOWN_OPERATIONS by identity", async () => {
    const { KNOWN_OPERATIONS: fromStore } = await import("./browserApprovalStore.helpers");
    const { KNOWN_OPERATIONS: fromLib } = await import("@/lib/browser/approval/grants");
    expect(fromStore).toBe(fromLib);
  });
});
