// vmark.workspace.save → coherence capture (WI-1.6, WI-LX1.4). The capture
// itself is pinned in services/coherence; this file pins that a SUCCESSFUL
// workspace.save reaches the kernel exactly once, as an MCP write carrying the
// exact text written, and that a save which was refused or failed never does.
//
// Only the Tauri boundary is mocked: the handler, the save pipeline and the
// capture chain are real, and "captured" is read at the kernel boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, doc, editDoc, newUntitledTab, openDocInTab, settle } from "@/test/tier0/harness";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { captures, resetBridge, responseTo } from "./bridgeDiskHarness";
import { TEST_ATTRIBUTION, TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import { mcpCoherenceAgent } from "@/services/coherence/mcpActor";

const CHAPTER = `${ROOT}/story/ch1.md`;

beforeEach(() => {
  resetBridge();
});

describe("workspace.save hands successful writes to coherence capture", () => {
  it("captures the exact content written, tagged with the tool name", async () => {
    const tabId = await openDocInTab(CHAPTER, "saved\n");
    editDoc(tabId, "edited body\n");

    await handleWorkspaceSave("req-1", {}, TEST_WRITE_CONTEXT);

    expect(responseTo("req-1").success).toBe(true);
    expect(statefulFs.read(CHAPTER)).toBe("edited body\n");
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0].request).toMatchObject({
      path: "story/ch1.md",
      content: "edited body\n",
      confidence: "inferred",
      agent: mcpCoherenceAgent(TEST_ATTRIBUTION),
      intent: { kind: "mcp-document-write", summary: "workspace.save" },
    });
  });

  it("a rejected capture never fails the save", async () => {
    const tabId = await openDocInTab(CHAPTER, "x\n");
    editDoc(tabId, "y\n");
    statefulFs.stubCommand("coherence_capture", () => {
      throw new Error("kernel down");
    });

    await handleWorkspaceSave("req-2", {}, TEST_WRITE_CONTEXT);

    expect(responseTo("req-2").success).toBe(true);
    expect(statefulFs.read(CHAPTER)).toBe("y\n");
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("does not capture when the disk write fails", async () => {
    const tabId = await openDocInTab(CHAPTER, "x\n");
    editDoc(tabId, "y\n");
    statefulFs.failWrites(new Error("EACCES"));

    await handleWorkspaceSave("req-3", {}, TEST_WRITE_CONTEXT);
    await settle();

    expect(responseTo("req-3").success).toBe(false);
    expect(captures).toEqual([]);
  });

  it("does not capture when the path guard refuses the write", async () => {
    const tabId = await openDocInTab(CHAPTER, "x\n");
    editDoc(tabId, "y\n");
    statefulFs.stubCommand("mcp_bridge_check_path", () => {
      throw new Error("outside roots");
    });

    await handleWorkspaceSave("req-4", {}, TEST_WRITE_CONTEXT);
    await settle();

    expect(responseTo("req-4").success).toBe(false);
    expect(statefulFs.writesTo(CHAPTER)).toEqual([]);
    expect(captures).toEqual([]);
  });

  it("does not capture an untitled tab (nothing is written)", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "draft\n");

    await handleWorkspaceSave("req-5", {}, TEST_WRITE_CONTEXT);
    await settle();

    expect(responseTo("req-5").success).toBe(false);
    expect(captures).toEqual([]);
  });
});
