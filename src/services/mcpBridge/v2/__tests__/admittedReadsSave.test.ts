// A saving document.write hands its save exactly the read batch it was
// admitted with: a read its client makes while the edit's prepare is held
// belongs to the client's next write, never to this save's capture.
//
// Real handler, real stores, real save pipeline; `@tauri-apps/*` is the only
// mocked boundary, so the batch is observed where it leaves the app — the
// inputs of the `coherence_capture` call the save makes.
import { it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { ROOT, openDocInTab } from "@/test/tier0/harness";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { detachMcpReads, dropAllMcpConnectionReads, recordMcpRead } from "@/services/coherence/mcpCapture";
import { readInputsOf } from "@/test/mcpReadInputs";
import { TEST_ATTRIBUTION, TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import { captures, resetBridge, responseTo } from "./bridgeDiskHarness";

const DOC = `${ROOT}/notes.md`;
const CONN = TEST_ATTRIBUTION.connectionId;

beforeEach(() => {
  resetBridge();
  dropAllMcpConnectionReads();
  // A pinned revision, so every read is one a capture carries.
  statefulFs.stubCommand("coherence_head", () => ({ object: "o", revision: "r" }));
});

afterEach(() => dropAllMcpConnectionReads());

it("a saving document.write hands its save the batch it was admitted with, never a read made during its prepare", async () => {
  const tabId = await openDocInTab(DOC, "old\n");
  recordMcpRead(CONN, `${ROOT}/before.md`, "before");
  fake.holdNextPrepare();
  const running = handleDocumentWrite("w1", { tabId, content: "new\n" }, TEST_WRITE_CONTEXT);
  await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalled());
  recordMcpRead(CONN, `${ROOT}/后来.md`, "later");
  fake.release();
  await running;

  expect(responseTo("w1").data).toMatchObject({ saved: true });
  expect(statefulFs.read(DOC)).toBe("new\n");
  await vi.waitFor(() => expect(captures).toHaveLength(1));
  const inputs = (captures[0].request as unknown as { inputs: { path: string }[] }).inputs;
  expect(inputs.map((i) => i.path)).toEqual(["before.md"]);
  expect(readInputsOf(detachMcpReads(CONN), ROOT).map((i) => i.path)).toEqual(["后来.md"]);
});
