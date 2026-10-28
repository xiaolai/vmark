// WI-AL2.2g — on Tauri's real webview IPC scripts (core.js and ipc-protocol.js from the pinned crate, located by cargo metadata, failing when absent) with forced callback ids: a command whose response-body read fails is executed again through the postMessage fallback with its payload byte for byte, so a prepare is resent under the same request; a reloaded page reuses the old page's callback ids, and the old page's prepared replies and commit acknowledgement delivered into the new page's callbacks apply nothing and confirm nothing; a prepare reply bound to another request is rejected before apply; a commit acknowledgement bound to another txn or page pair is not durable
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { untilReady } from "@/test/untilReady";

vi.unmock("@tauri-apps/api/core");
vi.unmock("@/services/agentJournal/journalTransport");

import { invoke } from "@tauri-apps/api/core";
import { installTauriIpc, type Answer, type Execution } from "@/test/tauriIpcHarness";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { journalActorFor } from "../journalActor";
import { controlledPrepare, type PrepareInput } from "../journalClient";
import { freezePreparePayload } from "../journalIpc";
import { runPrepareRequest } from "../journalRequest";
import { resetPageRegistration } from "../pageRegistration";
import { runJournaledMutation } from "../journaledMutation";
import { content, mutation, resetMutationFixture } from "./journaledMutationFixture";
import { INCARNATION, boundPair, boundPrepare, digestOf, preparedReply, registered } from "./journalWire";

const IDS = Array.from({ length: 40 }, (_, i) => 1000 + i);
const PREPARE = "agent_journal_prepare";
const COMMIT = "agent_journal_commit";

type Script = (e: Execution, args: Record<string, unknown>) => Answer | Promise<Answer>;
let script: Script;
let pending: Array<Promise<void>> = [];

/** The harness backend: decode the body, ask `script`, settle async answers into their callbacks. */
function backend(e: Execution): Answer {
  const parsed: unknown = JSON.parse(e.body);
  const args = typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
  const answer = script(e, args);
  if (!(answer instanceof Promise)) return answer;
  pending.push(answer.then((a) => (a === "hold" || a === "bodyFails" ? undefined : harness.deliver(a.ok ? e.callback : e.error, a.body))));
  return "hold";
}

let harness: ReturnType<typeof installTauriIpc>;
const of = (cmd: string) => harness.executions.filter((e) => e.cmd === cmd);

/** Registration echoes; everything else is the test's. */
const withRegister = (rest: Script): Script => (e, args) =>
  e.cmd === "agent_journal_register_page" ? { ok: true, body: registered(args.pageIdentity, "2") } : rest(e, args);

beforeEach(() => {
  resetMutationFixture();
  resetPageRegistration();
  pending = [];
  script = () => "hold";
  harness = installTauriIpc(backend, IDS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Tauri's IPC fallback: executed, the body read fails, executed again through postMessage", () => {
  it("tauri_ipc_fallback_repeats_an_executed_command", async () => {
    const P = JSON.stringify({ text: "稿 👋 \u2028 \\\"", generation: "9007199254740993" });
    let effects = 0;
    script = (e) => {
      effects += 1;
      return e.via === "customProtocol" ? "bodyFails" : { ok: true, body: "done" };
    };
    await expect(invoke("agent_journal_prepare", { payload: P })).resolves.toBe("done");
    expect(effects).toBe(2);
    const [first, second] = harness.executions;
    expect([first.via, second.via]).toEqual(["customProtocol", "postMessage"]);
    expect(second.body).toBe(first.body);
    const sentArgs: unknown = JSON.parse(second.body);
    expect(typeof sentArgs === "object" && sentArgs !== null && "payload" in sentArgs ? sentArgs.payload : null).toBe(P);
    expect([second.callback, second.error]).toEqual([first.callback, first.error]);
  });

  it("a prepare re-executed by the fallback is the same request: one requestId, one digest", async () => {
    script = withRegister((e, args) =>
      e.cmd === PREPARE && e.via === "customProtocol"
        ? "bodyFails"
        : boundPrepare(String(args.payload), preparedReply()).then((body) => ({ ok: true, body })),
    );
    const run = await runPrepareRequest({ build: () => controlledPrepare({ ...mutationFields() }) });
    expect(run.ok).toBe(true);
    if (run.ok) run.finish();
    const [a, b] = of(PREPARE);
    expect(b.body).toBe(a.body);
  });
});

function mutationFields(): PrepareInput {
  return { docKey: "path:/a.md", parent: null, preimage: "before", actor: journalActorFor(TEST_ATTRIBUTION), tool: "test.tool", baselineProvenance: null, baselineTouched: false };
}

describe("replies are bound to their request", () => {
  it("old_prepare_and_commit_replies_cannot_confirm_successor_write", async () => {
    // Page A: registered, two prepare attempts and a commit, every reply held when the page reloads.
    const aPage = { incarnation: INCARNATION, webviewGeneration: "1", pageIdentity: "a".repeat(32) };
    const aPayload = freezePreparePayload(mutationFields(), "6f1c2b8e-3d4a-4e5f-9a6b-7c8d9e0f1a2b", aPage);
    const aPair = { pageIdentity: aPage.pageIdentity, webviewGeneration: aPage.webviewGeneration };
    void invoke("agent_journal_register_page", { pageIdentity: aPage.pageIdentity });
    void invoke(PREPARE, { payload: aPayload });
    void invoke(PREPARE, { payload: aPayload });
    void invoke(COMMIT, { txn: "txn-1", ...aPair, payload: JSON.stringify({ postimage: "after" }) });
    const aIds = harness.executions.map((e) => e.callback);
    const aPrepared = await boundPrepare(aPayload, preparedReply());
    const aCommitted = boundPair({ txn: "txn-1", ...aPair }, { doc: "path:/a.md", revision: "rev-1", applied: true, durable: true, certified: false, fallbackReason: null });

    // The reload: a fresh callback table that reuses A's ids; page B registers and writes.
    harness.reload();
    resetPageRegistration();
    harness.executions.length = 0;
    script = withRegister(() => "hold");
    const out = runJournaledMutation(mutation());
    await untilReady(() => of(PREPARE).length === 1);
    harness.deliver(aIds[1], aPrepared);
    await untilReady(() => of(PREPARE).length === 2);
    harness.deliver(aIds[2], aPrepared);
    await untilReady(() => of("agent_journal_abandon").length === 1);
    harness.deliver(aIds[3], aCommitted);

    expect(harness.executions.map((e) => e.callback)).toEqual(aIds);
    expect(await out).toMatchObject({ status: "refused", refusal: { uncertain: true } });
    expect(content()).toBe("before");
    expect(of(COMMIT)).toEqual([]);
  });

  it("a prepare reply for another request id is rejected before apply", async () => {
    script = withRegister(async (e, args) => {
      if (e.cmd !== PREPARE) return { ok: true, body: { state: "fenced" } };
      const other = String(args.payload).replace(/"requestId":"[^"]+"/, '"requestId":"0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"');
      return { ok: true, body: { bind: { requestId: JSON.parse(other).requestId, digest: await digestOf(other) }, reply: preparedReply() } };
    });
    const out = await runJournaledMutation(mutation());
    await Promise.all(pending);
    expect(out).toMatchObject({ status: "refused", refusal: { uncertain: true } });
    expect(content()).toBe("before");
    expect(of(PREPARE)).toHaveLength(2);
    expect(of(COMMIT)).toEqual([]);
  });

  it.each([
    ["another txn", { txn: "txn-other" }],
    ["another page", { pageIdentity: "b".repeat(32) }],
    ["another generation", { webviewGeneration: "1" }],
  ])("a commit acknowledgement for %s is not durable", async (_label, swap) => {
    script = withRegister(async (e, args) => {
      if (e.cmd === PREPARE) return { ok: true, body: await boundPrepare(String(args.payload), preparedReply()) };
      const committed = { doc: "path:/a.md", revision: "rev-1", applied: true, durable: true, certified: false, fallbackReason: null };
      return { ok: true, body: boundPair({ ...args, ...swap }, committed) };
    });
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "applied", durable: false });
    expect(of(COMMIT)).toHaveLength(1);
  });
});
