// WI-AL1.4 — every MCP save reply says whether the agent edit journal
// recorded the saved text: `journaled` "yes" | "pending" | "no".
//
// Real handlers, real stores, real save pipeline; the journal is the shared
// fake. A save whose capture fails or is refused still saved the file, so the
// reply is a success that says `journaled: "no"`; it is never an error.
// document.write's save names the agent as the author of its text, also when
// the journal refused the write's own commit.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { agentJournalFake } from "@/test/agentJournalFake";
import { ROOT, editDoc, openDocInTab } from "@/test/tier0/harness";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";
import { resetBridge, responseTo } from "./bridgeDiskHarness";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const DOC = `${ROOT}/notes.md`;
const NEW = `${ROOT}/renamed.md`;
const EDITED = "# 标题\n\n正文 🙂\n";

function dataOf(id: string): Record<string, unknown> {
  const r = responseTo(id);
  expect(r.success).toBe(true);
  return r.data as Record<string, unknown>;
}

/**
 * Each entry also says how its save comes to be unrecorded. A human edit
 * saved through `workspace.*` is recorded by the save's own capture, so a
 * failed capture append leaves it "no". `document.write` already recorded
 * its text as the journal head, so its save appends nothing; it is "no" only
 * while the write's own record is still queued.
 */
const SAVES = [
  {
    tool: "document.write",
    failRecord() {
      agentJournalFake.failNextCommits(1);
    },
    async run(tabId: string, id: string) {
      await handleDocumentWrite(id, { tabId, content: EDITED }, TEST_WRITE_CONTEXT);
    },
  },
  {
    tool: "workspace.save",
    failRecord() {
      agentJournalFake.failNextCaptures(1);
    },
    async run(tabId: string, id: string) {
      editDoc(tabId, EDITED);
      await handleWorkspaceSave(id, { tabId }, TEST_WRITE_CONTEXT);
    },
  },
  {
    tool: "workspace.save_as",
    failRecord() {
      agentJournalFake.failNextCaptures(1);
    },
    async run(tabId: string, id: string) {
      editDoc(tabId, EDITED);
      await handleWorkspaceSaveAs(id, { tabId, filePath: NEW }, TEST_WRITE_CONTEXT);
    },
  },
] as const;

beforeEach(() => {
  resetBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SAVES)("$tool reports journaled", ({ run, failRecord }) => {
  it("answers journaled yes when the saved text is recorded", async () => {
    const tabId = await openDocInTab(DOC, "# 标题\n");

    await run(tabId, "req-yes");

    expect(dataOf("req-yes").journaled).toBe("yes");
  });

  it("answers journaled no, still a success, when the record fails to append", async () => {
    const tabId = await openDocInTab(DOC, "# 标题\n");
    failRecord();

    await run(tabId, "req-no");

    const data = dataOf("req-no");
    expect(data.journaled).toBe("no");
    expect(statefulFs.writes.some((w) => w.content === EDITED)).toBe(true);
  });

  it("answers journaled no when the journal refuses the capture", async () => {
    const tabId = await openDocInTab(DOC, "# 标题\n");
    agentJournalFake.refuseNextCaptures("JOURNAL_UNAVAILABLE", "JOURNAL_UNAVAILABLE");

    await run(tabId, "req-refused");

    expect(dataOf("req-refused").journaled).toBe("no");
  });
});

describe("document.write save capture", () => {
  it("answers yes without appending: the write already recorded the saved text", async () => {
    const tabId = await openDocInTab(DOC, "# 标题\n");
    agentJournalFake.failNextCaptures(1);

    await handleDocumentWrite("req-head", { tabId, content: EDITED }, TEST_WRITE_CONTEXT);

    expect(dataOf("req-head").journaled).toBe("yes");
  });

  it("records the agent as the author of the saved text after its commit was refused", async () => {
    const tabId = await openDocInTab(DOC, "# 标题\n");
    agentJournalFake.refuseNextCommits(1);

    await handleDocumentWrite("req-refused-commit", { tabId, content: EDITED }, TEST_WRITE_CONTEXT);

    expect(dataOf("req-refused-commit").saved).toBe(true);
    const calls = agentJournalFake.captureSaveToJournal.mock.calls;
    const input = calls[calls.length - 1][0];
    expect(input).toMatchObject({ postimage: EDITED, initiator: { type: "mcp" }, author: { type: "mcp" } });
    expect(agentJournalFake.doc(`path:${DOC}`).text).toBe(EDITED);
  });

  it("carries no journaled field when the save is skipped", async () => {
    const tabId = await openDocInTab(DOC, "# 标题\n");

    await handleDocumentWrite("req-optout", { tabId, content: EDITED, save: false }, TEST_WRITE_CONTEXT);

    const data = dataOf("req-optout");
    expect(data.save_skipped).toBe("opt_out");
    expect(data).not.toHaveProperty("journaled");
  });
});
