// @vitest-environment node
// WI-AL2.2a — a controlled prepare's request identity on the wire: each logical prepare (an agent write, a restore) mints one UUID v4 requestId and sends its payload as one JSON string with that id last; the capture id crosses verbatim; the resend without a refused baseline map is a new logical request and carries a new requestId; a prepare reply is decoded losslessly (certified and fallbackReason kept, field order preserved), and a restore reply likewise | AL2.2g: the payload is frozen with the request id, then the page identity (incarnation, generation, page id) after it, and every reply is bound to that payload; the map's refusal is a notAdmitted request answer naming the field
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

vi.unmock("@/services/agentJournal/journalTransport");
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { stubProvenancePayload } from "@/test/provenancePayloadFixture";
import { journalActorFor } from "../journalActor";
import { controlledPrepare, type PrepareInput, type PrepareSpec } from "../journalClient";
import { restorePrepare, type RestorePrepareInput } from "../historyClient";
import { runPrepareRequest } from "../journalRequest";
import { resetPageRegistration } from "../pageRegistration";
import type { CaptureId } from "../provenance/captureId";
import { INCARNATION, boundPrepare, requestAnswer, scriptWire } from "./journalWire";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TXN = "0190d3c4-0000-7000-8000-000000000001";
const REV = "0190d3c4-0000-7000-8000-000000000002";
const DOC = "0190d3c4-0000-7000-8000-000000000003";
const CAPTURE: CaptureId = { view: "main/t-1", session: "0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b", seq: "18446744073709551615" };

const input: PrepareInput = {
  docKey: "path:/a.md",
  parent: null,
  preimage: "before 稿",
  actor: journalActorFor(TEST_ATTRIBUTION),
  tool: "document.write",
  baselineProvenance: null,
  baselineTouched: false,
};
const restoreInput: RestorePrepareInput = {
  docKey: "path:/a.md",
  parent: REV,
  preimage: "unsaved",
  source: { from: "revision", revision: REV },
  baselineProvenance: null,
  baselineTouched: false,
};

const CONTROLLED = { doc: DOC, txn: TXN, revision: REV, generation: "1", baseline: REV, certified: false, fallbackReason: "notTheParent" };
const RESTORED = { doc: DOC, txn: TXN, revision: REV, generation: "2", baseline: null, text: "原文\r\n", resolves: TXN };


let wire: ReturnType<typeof scriptWire>;

/** Run one prepare request over `spec`; its prepared reply, or its refusal thrown. */
async function prepare<P extends { txn: string }>(spec: PrepareSpec<P>): Promise<P> {
  const run = await runPrepareRequest({ build: () => spec });
  if (!run.ok) throw run.refusal;
  run.finish();
  return run.prepared;
}

/** Answer `command` with `reply` bound to the payload it carried. */
const answer = (command: string, reply: unknown) => wire.on(command, (a) => boundPrepare(String(a.payload), reply));

const payloads = (command: string): string[] => wire.payloadsOf(command);
const sent = (command: string) => payloads(command).map((p) => JSON.parse(p) as Record<string, unknown>);

/** The page identity the registration answered, in its wire order. */
function pageOf(command: string) {
  const [register] = wire.argsOf("agent_journal_register_page");
  const { webviewGeneration } = sent(command)[0];
  return { incarnation: INCARNATION, webviewGeneration, pageIdentity: register.pageIdentity };
}

beforeEach(() => {
  resetPageRegistration();
  wire = scriptWire();
});

describe("request identity", () => {
  it("sends the prepare as one JSON string: the input, a fresh v4 requestId, then the page identity", async () => {
    answer("agent_journal_prepare", CONTROLLED);
    await prepare(controlledPrepare(input));
    const [payload] = payloads("agent_journal_prepare");
    const { requestId } = JSON.parse(payload) as { requestId: string };
    expect(requestId).toMatch(UUID_V4);
    expect(payload).toBe(JSON.stringify({ ...input, requestId, ...pageOf("agent_journal_prepare") }));
  });

  it("mints a different requestId for each logical prepare", async () => {
    answer("agent_journal_prepare", CONTROLLED);
    await prepare(controlledPrepare(input));
    await prepare(controlledPrepare(input));
    const [a, b] = sent("agent_journal_prepare").map((p) => p.requestId);
    expect(a).not.toBe(b);
  });

  it("sends the capture id verbatim", async () => {
    answer("agent_journal_prepare", CONTROLLED);
    await prepare(controlledPrepare({ ...input, capture: CAPTURE }));
    expect(sent("agent_journal_prepare")[0]).toMatchObject({ capture: CAPTURE });
  });

  it("resends a prepare whose baseline map was refused as a new request: a new requestId, the same capture", async () => {
    let n = 0;
    wire.on("agent_journal_prepare", async (a) => {
      n += 1;
      const payload = String(a.payload);
      if (n > 1) return boundPrepare(payload, CONTROLLED);
      throw await requestAnswer(payload, "INVALID_REQUEST", false, { state: "notAdmitted" }, { field: "provenance" });
    });
    const map = stubProvenancePayload({ epoch: "1", basis: "genesis" });
    await prepare(controlledPrepare({ ...input, baselineProvenance: map, capture: CAPTURE }));
    const [first, second] = sent("agent_journal_prepare");
    expect(first).toMatchObject({ baselineProvenance: map, capture: CAPTURE });
    expect(second).toMatchObject({ baselineProvenance: null, capture: CAPTURE });
    expect(second.requestId).toMatch(UUID_V4);
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("gives a restore prepare its own requestId and capture", async () => {
    answer("agent_journal_restore_prepare", RESTORED);
    await prepare(restorePrepare({ ...restoreInput, capture: CAPTURE }));
    const [payload] = payloads("agent_journal_restore_prepare");
    const { requestId } = JSON.parse(payload) as { requestId: string };
    expect(requestId).toMatch(UUID_V4);
    expect(payload).toBe(JSON.stringify({ ...restoreInput, capture: CAPTURE, requestId, ...pageOf("agent_journal_restore_prepare") }));
  });
});

describe("lossless replies", () => {
  it("keeps every field of a controlled prepare reply, in wire order", async () => {
    answer("agent_journal_prepare", CONTROLLED);
    const p = await prepare(controlledPrepare(input));
    expect(JSON.stringify(p)).toBe(JSON.stringify(CONTROLLED));
  });

  it("keeps every field of a restore reply, in wire order", async () => {
    answer("agent_journal_restore_prepare", RESTORED);
    const p = await prepare(restorePrepare(restoreInput));
    expect(JSON.stringify(p)).toBe(JSON.stringify(RESTORED));
  });
});
