// @vitest-environment node
// Audit 2026-09-03 round 4 (#153) — the attach-approval transitions. An attach is an
// IPC that can fail, arrive late, or arrive for a page the tab has since left, so its
// outcome is judged against a TOKEN (the pending entry captured at the click) and the
// tab's CURRENT generation — and a failure is a visible state, not silence.
import { describe, expect, it } from "vitest";
import { ATTACH_FAILED_KEY, beginAttach, settleAttach } from "./browserApprovalStore.attach";
import type { HumanTabAttachment, PendingApproval } from "./browserApprovalStore.types";

function attachPrompt(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "a1",
    targetUrl: "https://site.example/page",
    operation: "attach",
    tabId: "tab-1",
    generation: 3,
    ...overrides,
  };
}

const state = (pending: PendingApproval[], resolving: string[] = [], attachments: HumanTabAttachment[] = []) => ({
  pending,
  resolving,
  attachments,
});
const generationIs = (n: number | undefined) => () => n;

describe("beginAttach", () => {
  it("marks the prompt in flight and hands back the very pending entry as the token", () => {
    const req = attachPrompt();
    const other = attachPrompt({ id: "b" });
    const { patch, token } = beginAttach(state([other, req]), req);
    expect(token).toBe(req);
    expect(patch.pending[1]).toBe(req);
    expect(patch.resolving).toEqual(["a1"]);
  });

  it("clears the previous attempt's error; the token is the cleared entry, which pending now holds", () => {
    const failed = attachPrompt({ attachError: ATTACH_FAILED_KEY });
    const other = attachPrompt({ id: "b" });
    const { patch, token } = beginAttach(state([other, failed], ["z"]), failed);
    expect(token.attachError).toBeUndefined();
    expect(token).not.toBe(failed);
    expect(patch.pending).toEqual([other, token]);
    expect(patch.pending[0]).toBe(other); // an untouched entry keeps its identity
    expect(patch.pending[1]).toBe(token);
    expect(patch.resolving).toEqual(["z", "a1"]);
  });
});

describe("settleAttach", () => {
  const req = attachPrompt();

  it("success while still pending on the same page records the mirror and drops the prompt", () => {
    expect(settleAttach(state([req], ["a1"]), req, true, true, generationIs(3))).toEqual({
      resolving: [],
      pending: [],
      attachments: [{ tabId: "tab-1", generation: 3, once: true }],
    });
  });

  it("carries the standing/one-shot choice through to the mirror", () => {
    const next = settleAttach(state([req], ["a1"]), req, true, false, generationIs(3));
    expect(next.attachments).toEqual([{ tabId: "tab-1", generation: 3, once: false }]);
  });

  it("a re-attach replaces the tab's existing mirror entry rather than accumulating", () => {
    const stale: HumanTabAttachment = { tabId: "tab-1", generation: 2, once: false };
    const next = settleAttach(state([req], ["a1"], [stale]), req, true, true, generationIs(3));
    expect(next.attachments).toEqual([{ tabId: "tab-1", generation: 3, once: true }]);
  });

  it("success after the page moved on drops the prompt and records NOTHING", () => {
    expect(settleAttach(state([req], ["a1"]), req, true, true, generationIs(4))).toEqual({
      resolving: [],
      pending: [],
    });
  });

  it("success for a tab the store cannot see records nothing", () => {
    expect(settleAttach(state([req], ["a1"]), req, true, true, generationIs(undefined))).toEqual({
      resolving: [],
      pending: [],
    });
  });

  it("success after the prompt was withdrawn only clears the in-flight mark", () => {
    expect(settleAttach(state([], ["a1"]), req, true, true, generationIs(3))).toEqual({ resolving: [] });
  });

  // The token is the ENTRY, not its id: an id can be re-raised by the untrusted
  // client after the original prompt was dropped.
  it("a prompt re-raised under the same id is not the token: nothing recorded, and it stays pending", () => {
    const reraised = attachPrompt();
    expect(reraised).toEqual(req);
    expect(settleAttach(state([reraised], ["a1"]), req, true, true, generationIs(3))).toEqual({ resolving: [] });
  });

  it("failure keeps the prompt raised, names the error by i18n key, and clears the in-flight mark", () => {
    const next = settleAttach(state([req], ["a1"]), req, false, true, generationIs(3));
    expect(next).toEqual({ resolving: [], pending: [{ ...req, attachError: ATTACH_FAILED_KEY }] });
  });

  it("failure after the prompt was withdrawn only clears the in-flight mark", () => {
    expect(settleAttach(state([], ["a1"]), req, false, true, generationIs(3))).toEqual({ resolving: [] });
  });

  it("leaves other prompts' in-flight marks and entries alone", () => {
    const other = attachPrompt({ id: "b" });
    const next = settleAttach(state([other, req], ["b", "a1"]), req, false, true, generationIs(3));
    expect(next.resolving).toEqual(["b"]);
    expect(next.pending?.[0]).toBe(other);
  });

  it("the error is an i18n key, never English prose", () => {
    expect(ATTACH_FAILED_KEY).toMatch(/^browser\.approval\.[A-Za-z.]+$/);
  });
});
