// @vitest-environment node
// WI-AL2.2b — an abandon's reply is read from the closed set of states the journal answers: fenced, aborted, abortQueued, an ended request's terminalPending, terminal or abandoned, and a revert's recorded decision (decided); any other reply is warned about as malformed
import { beforeEach, describe, expect, it, vi } from "vitest";

const { journalWarn } = vi.hoisted(() => ({ journalWarn: vi.fn() }));
vi.unmock("@/services/agentJournal/journalTransport");
vi.mock("@/utils/debug", async (importOriginal) => ({ ...(await importOriginal<object>()), journalWarn }));

import { abandonRequest } from "../requestEnding";
import { digestOf, scriptWire } from "./journalWire";

const REQUEST = "00000000-0000-4000-8000-000000000001";
const PAYLOAD = JSON.stringify({ requestId: REQUEST });
const PAIR = { pageIdentity: "p", webviewGeneration: "1" };

let wire: ReturnType<typeof scriptWire>;

/** Abandon PAYLOAD with the journal answering `reply` (an abandon reply is unbound: `{state}`). */
async function abandonAnswered(reply: unknown): Promise<void> {
  wire.on("agent_journal_abandon", () => reply);
  await abandonRequest(PAYLOAD, { requestId: REQUEST, digest: await digestOf(PAYLOAD) }, PAIR);
}

describe("abandonRequest", () => {
  beforeEach(() => {
    wire = scriptWire();
    journalWarn.mockReset();
  });

  it.each(["fenced", "aborted", "abortQueued", "terminalPending", "terminal", "abandoned", "decided"])(
    "accepts the journal's %s answer",
    async (state) => {
      await abandonAnswered({ state });
      expect(wire.payloadsOf("agent_journal_abandon")).toEqual([PAYLOAD]);
      expect(journalWarn).not.toHaveBeenCalled();
    },
  );

  it.each([{ state: "reverted" }, { state: "" }, {}, null])("warns about a malformed reply %j", async (reply) => {
    await abandonAnswered(reply);
    expect(journalWarn).toHaveBeenCalledWith(expect.stringContaining("malformed reply"), reply);
  });
});
