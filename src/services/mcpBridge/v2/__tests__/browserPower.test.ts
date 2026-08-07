// @vitest-environment node
// WI-P5.1/P5.2/P5.3 — scripted power tools: query (read), style (act), and
// execute_js (eval — per-call approval only, result flagged untrusted).
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "@/services/mcpBridge/utils";
import { handleBrowserQuery, handleBrowserStyle, handleBrowserExecuteJs } from "@/services/mcpBridge/v2/browserPower";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const BLOG = "https://blog.example.com/";
function seed(): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  const id = useTabStore.getState().createBrowserTab("main", BLOG, "Blog", "ai-sandbox");
  useTabStore.getState().updateBrowserTab(id, { generation: 1 });
  return id;
}
function grant(...ops: string[]) {
  useBrowserApprovalStore.getState().grant("https://blog.example.com", ops);
}
function lastResponse() {
  const c = vi.mocked(respond).mock.calls;
  return c[c.length - 1][0];
}
function evalCall() {
  return invoke.mock.calls.find((c) => c[0] === "browser_eval")?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("handleBrowserQuery (read-class)", () => {
  it("queries by selector and returns the structured result", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ count: 1, elements: [{ ref: "e1", tag: "button" }] }));
    await handleBrowserQuery("q1", { tabId: id, selector: "button" });
    expect(evalCall()).toMatchObject({ operation: "read", generation: 1 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkQueryDom"));
    expect(lastResponse()).toMatchObject({ id: "q1", success: true, data: { count: 1 } });
  });

  it("refuses a missing selector", async () => {
    const id = seed();
    await handleBrowserQuery("q2", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});

describe("handleBrowserStyle (act-class, op=style)", () => {
  it("applies a style on a granted origin", async () => {
    const id = seed();
    grant("style");
    invoke.mockResolvedValue(JSON.stringify({ found: true, styled: true }));
    await handleBrowserStyle("s1", { tabId: id, selector: ".overlay", set: { display: "none" } });
    expect(evalCall()).toMatchObject({ operation: "style", generation: 1 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkStyleOp"));
    expect(lastResponse()).toMatchObject({ success: true, data: { result: { styled: true } } });
  });

  it("requests approval for style on an un-granted origin", async () => {
    const id = seed();
    await handleBrowserStyle("s2", { tabId: id, selector: ".x", set: { color: "red" } });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "style" });
  });

  it("responds queue-full (NOT needsApproval) when the approval queue is at capacity", async () => {
    const { MAX_PENDING_APPROVALS } = await import("@/stores/browserApprovalStore");
    const id = seed();
    // Fill the queue with unrelated pending prompts.
    const store = useBrowserApprovalStore.getState();
    for (let i = 0; i < MAX_PENDING_APPROVALS; i++) {
      store.requestApproval(`fill-${i}`, BLOG, "click", { role: "button", name: `b${i}` } as never, id, 1);
    }
    await handleBrowserStyle("s-full", { tabId: id, selector: ".x", set: { color: "red" } });
    expect(invoke).not.toHaveBeenCalled();
    const res = lastResponse();
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain("approval queue is full");
    expect((res.data as { needsApproval?: boolean } | undefined)?.needsApproval).toBeUndefined();
  });

  it("rejects invalid class tokens atomically", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s-cls", { tabId: id, selector: ".x", addClasses: ["ok", "bad token"] });
    expect(invoke).not.toHaveBeenCalled();
    expect(String(lastResponse().error)).toContain("single class tokens");
  });

  it("rejects a non-object 'set' payload", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s-set", { tabId: id, selector: ".x", set: 5 });
    expect(invoke).not.toHaveBeenCalled();
    expect(String(lastResponse().error)).toContain("must be an object");
  });

  it("rejects a non-string 'set' value with the field name", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s-setv", { tabId: id, selector: ".x", set: { color: 7 } });
    expect(invoke).not.toHaveBeenCalled();
    expect(String(lastResponse().error)).toContain("set['color']");
  });

  it("rejects a non-array class list", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s-arr", { tabId: id, selector: ".x", removeClasses: "x" });
    expect(invoke).not.toHaveBeenCalled();
    expect(String(lastResponse().error)).toContain("must be an array");
  });

  it("rejects ref AND selector together", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s-both", { tabId: id, ref: "r1", selector: ".x", set: { color: "red" } });
    expect(invoke).not.toHaveBeenCalled();
    expect(String(lastResponse().error)).toContain("not both");
  });

  it("rejects injectCss combined with element ops", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s-mix", { tabId: id, selector: ".x", set: { color: "red" }, injectCss: "body{}" });
    expect(invoke).not.toHaveBeenCalled();
    expect(String(lastResponse().error)).toContain("cannot be combined");
  });

  it("refuses when neither a target nor an operation is given", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s3", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });

  // Security review P5 (Medium #4): style is payload-bound like eval — an
  // Allow-once for one styling must not authorize a different one on the retry.
  it("refuses a substituted style payload under a prior Allow-once", async () => {
    const id = seed();
    await handleBrowserStyle("st-a", { tabId: id, selector: ".x", set: { color: "red" } });
    useBrowserApprovalStore.getState().resolveApproval("st-a", "once");
    invoke.mockResolvedValue(JSON.stringify({ styled: true }));
    await handleBrowserStyle("st-b", { tabId: id, selector: ".x", set: { color: "blue" } });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
  });

  it("refuses an oversized injectCss payload", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s4", { tabId: id, injectCss: "a".repeat(64 * 1024 + 1) });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});

describe("handleBrowserExecuteJs (eval — per-call approval only)", () => {
  it("requires a fresh per-call approval; a grant never authorizes it", async () => {
    const id = seed();
    grant("eval"); // stripped from the grant — must not help
    await handleBrowserExecuteJs("x1", { tabId: id, script: "return document.title;" });
    expect(invoke).not.toHaveBeenCalled();
    const res = lastResponse();
    expect((res.data as { needsApproval?: boolean }).needsApproval).toBe(true);
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "eval" });
  });

  it("runs the caller script after an Allow-once and flags the result untrusted", async () => {
    const id = seed();
    // First call raises approval; user clicks Allow once; retry runs.
    await handleBrowserExecuteJs("x-a", { tabId: id, script: "return 2+2;" });
    useBrowserApprovalStore.getState().resolveApproval("x-a", "once");
    invoke.mockResolvedValue(JSON.stringify(4));
    await handleBrowserExecuteJs("x-b", { tabId: id, script: "return 2+2;" });
    expect(evalCall()).toMatchObject({ operation: "eval", generation: 1 });
    expect(evalCall()?.script).toBe("return 2+2;");
    const res = lastResponse();
    expect(res).toMatchObject({ id: "x-b", success: true });
    expect((res.data as { untrusted?: boolean }).untrusted).toBe(true);
  });

  it("refuses a missing script", async () => {
    const id = seed();
    await handleBrowserExecuteJs("x2", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });

  // Security review P5 re-verify (High #1 availability): the untrusted client
  // cannot flood the store/dialog with an unbounded script.
  it("refuses an oversized script before any approval is queued", async () => {
    const id = seed();
    await handleBrowserExecuteJs("x3", { tabId: id, script: "x".repeat(64 * 1024 + 1) });
    expect(invoke).not.toHaveBeenCalled();
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    expect(lastResponse()).toMatchObject({ success: false });
  });

  // Security review P5 (High #1): the one-shot binds the EXACT script. Approving a
  // harmless script A must not let the AI run a substituted script B on the retry.
  it("refuses a substituted script under a prior Allow-once (approve A, run B)", async () => {
    const id = seed();
    await handleBrowserExecuteJs("sub-a", { tabId: id, script: "return document.title;" });
    useBrowserApprovalStore.getState().resolveApproval("sub-a", "once");
    invoke.mockResolvedValue(JSON.stringify("stolen"));
    // Retry with a DIFFERENT script — the approval bound script A, so B is refused
    // and must raise a fresh approval rather than ride the prior one-shot.
    await handleBrowserExecuteJs("sub-b", { tabId: id, script: "return document.cookie;" });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
  });
});

// Round-1 audit finding (browserPower.ts, Medium): MAX_SCRIPT_BYTES names BYTES
// but was enforced with String.length, which counts UTF-16 code units. A CJK or
// emoji payload therefore passed at up to ~3x the stated cap. This is the only
// size gate that exists — the Rust `browser_eval` command takes an unbounded
// String — so it has to measure the unit it claims to.
describe("script size cap is measured in UTF-8 bytes", () => {
  // 30,000 code units (under the 65536 .length check) but 90,000 UTF-8 bytes.
  const CJK_OVER_CAP = "\u6c49".repeat(30_000);

  it("the fixture really is under the cap in code units and over it in bytes", () => {
    expect(CJK_OVER_CAP.length).toBeLessThan(64 * 1024);
    expect(new TextEncoder().encode(CJK_OVER_CAP).length).toBeGreaterThan(64 * 1024);
  });

  it("refuses a CJK execute_js script that only a byte measurement catches", async () => {
    const id = seed();
    grant("eval");
    await handleBrowserExecuteJs("cjk-js", { tabId: id, script: CJK_OVER_CAP });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });

  it("refuses a CJK injectCss payload on the same basis", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("cjk-css", { tabId: id, injectCss: CJK_OVER_CAP });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });

  it("accepts an ASCII payload whose BUILT script stays under the byte cap", async () => {
    const { buildStyleScript } = await import("@/lib/browser/agent/powerScript");
    // The cap is measured on the built script (matching Rust's authoritative
    // gate), so derive the wrapper overhead from the real builder.
    const overhead = new TextEncoder().encode(
      buildStyleScript({}, 1, { injectCss: "" })
    ).length;
    const id = seed();
    grant("style");
    await handleBrowserStyle("ascii-ok", {
      tabId: id,
      injectCss: "a".repeat(64 * 1024 - overhead - 64),
    });
    expect(invoke).toHaveBeenCalled();
  });

  it("refuses raw CSS just under the cap whose wrapped script exceeds it", async () => {
    const id = seed();
    grant("style");
    // Previously this passed the client mirror (raw CSS measured) and was
    // rejected only by Rust AFTER wrapping — an opaque late failure. The
    // mirror now measures the built script, so the refusal is client-side
    // and names the real cause.
    await handleBrowserStyle("ascii-wrapped-over", {
      tabId: id,
      injectCss: "a".repeat(64 * 1024 - 10),
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({
      success: false,
      error: expect.stringContaining("wrapped CSS"),
    });
  });
});
