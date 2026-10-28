// WI-AL2.2i — on Tauri's real webview IPC scripts with forced callback ids (a_misdelivered_capture_reply_cannot_mark_a_save_recorded): a reloaded page reuses the old page's callback ids, so the old page's capture reply, journaled yes, lands in the new page's capture callback; bound to the old call's callId, it is refused as JOURNAL_UNAVAILABLE and never reports the new save recorded, while the new call's own reply, delivered into its own callback, is read
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { untilReady } from "@/test/untilReady";

vi.unmock("@tauri-apps/api/core");
vi.unmock("@/services/agentJournal/journalTransport");

import { installTauriIpc, type Execution } from "@/test/tauriIpcHarness";
import { captureSaveToJournal, type CaptureInput } from "../journalClient";

const IDS = Array.from({ length: 8 }, (_, i) => 2000 + i);
const DOC = "0190d3c4-0000-7000-8000-000000000003";
const OLD_REV = "0190d3c4-0000-7000-8000-000000000002";
const NEW_REV = "0190d3c4-0000-7000-8000-000000000005";

const capture = (postimage: string): CaptureInput => ({
  docKey: "path:/读书.md",
  window: "main/t1",
  observedParent: null,
  postimage,
  initiator: { type: "human" },
  author: null,
  claimsRevision: null,
  provenance: null,
});

const recorded = (revision: string) => ({ doc: DOC, journaled: "yes", observation: null, revision });

let harness: ReturnType<typeof installTauriIpc>;

function callIdOf(e: Execution): string {
  const args: unknown = JSON.parse(e.body);
  if (typeof args !== "object" || args === null || !("callId" in args) || typeof args.callId !== "string") {
    throw new Error(`${e.cmd} was sent without a callId`);
  }
  return args.callId;
}

beforeEach(() => {
  harness = installTauriIpc(() => "hold", IDS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a capture reply delivered into another page's callback", () => {
  it("a_misdelivered_capture_reply_cannot_mark_a_save_recorded", async () => {
    void captureSaveToJournal(capture("old page")).catch(() => undefined);
    await untilReady(() => harness.executions.length === 1);
    const old = harness.executions[0];

    harness.reload();
    const settled = captureSaveToJournal(capture("new page")).then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await untilReady(() => harness.executions.length === 2);
    const fresh = harness.executions[1];
    expect(fresh.callback).toBe(old.callback);
    expect(callIdOf(fresh)).not.toBe(callIdOf(old));

    // Rust answers the old page's call into the callback id the new page now owns.
    harness.deliver(old.callback, { bind: { callId: callIdOf(old) }, reply: recorded(OLD_REV) });
    const out = await settled;
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.e).toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("reads the new call's own reply in its own callback", async () => {
    const settled = captureSaveToJournal(capture("new page"));
    await untilReady(() => harness.executions.length === 1);
    const e = harness.executions[0];
    harness.deliver(e.callback, { bind: { callId: callIdOf(e) }, reply: recorded(NEW_REV) });
    await expect(settled).resolves.toEqual(recorded(NEW_REV));
  });
});
