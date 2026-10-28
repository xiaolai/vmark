// An MCP save takes its place among the document's saves when the request is ADMITTED, not when
// its path guard (or Save As preflight) has finished awaiting: a request delayed in that await can
// neither land its older bytes after a newer save of the file, nor re-point the tab after a newer
// Save As, nor override the path a later Save As chose. Real handlers, stores and save pipeline
// over the stateful disk; the guard's Tauri round trip is the await being held.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, doc, editDoc, openDocInTab } from "@/test/tier0/harness";
import { useTabStore } from "@/stores/tabStore";
import { saveToPath } from "@/services/persistence/saveToPath";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";
import { resetBridge, responseTo, structuredErrorOf } from "./bridgeDiskHarness";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const DOC = `${ROOT}/notes.md`;
const FIRST = `${ROOT}/第一.md`;
const SECOND = `${ROOT}/second.md`;

/**
 * Hold the next path-guard round trip. `release(reason)` answers it: allowed,
 * or refused with `reason`.
 */
function holdNextGuard(): { held: () => boolean; release: (refusal?: string) => void } {
  let answer: ((refusal?: string) => void) | null = null;
  let taken = false;
  statefulFs.stubCommand("mcp_bridge_check_path", () => {
    if (taken) return undefined;
    taken = true;
    return new Promise<void>((resolve, reject) => {
      answer = (refusal) => (refusal ? reject({ code: "invalid-input", message: refusal }) : resolve());
    });
  });
  return {
    held: () => answer !== null,
    release: (refusal) => {
      if (!answer) throw new Error("no guard call is held");
      answer(refusal);
    },
  };
}

const tabPath = (tabId: string) => {
  const tab = useTabStore.getState().findTabById(tabId);
  return tab && tab.kind === "document" ? tab.filePath : undefined;
};

beforeEach(() => {
  resetBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workspace.save delayed in its path guard", () => {
  it("does not land its older bytes after a later save of the same file", async () => {
    const tabId = await openDocInTab(DOC, "v0\n");
    editDoc(tabId, "older\n");
    const guard = holdNextGuard();
    const request = handleWorkspaceSave("s-old", { tabId }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(guard.held()).toBe(true));

    editDoc(tabId, "newer\n");
    const later = saveToPath(tabId, DOC, "newer\n");
    guard.release();
    await Promise.all([request, later]);

    expect(responseTo("s-old").success).toBe(true);
    expect(statefulFs.read(DOC)).toBe("newer\n");
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("does not re-point the tab after a later Save As", async () => {
    const tabId = await openDocInTab(DOC, "v0\n");
    editDoc(tabId, "text\n");
    const guard = holdNextGuard();
    const request = handleWorkspaceSave("s-stale", { tabId }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(guard.held()).toBe(true));

    const saveAs = saveToPath(tabId, SECOND, "text\n");
    await saveAs;
    guard.release();
    await request;

    expect(doc(tabId).filePath).toBe(SECOND);
    expect(tabPath(tabId)).toBe(SECOND);
  });

  it("a refused guard writes nothing, answers INVALID_PATH, and does not wedge the file's queue", async () => {
    const tabId = await openDocInTab(DOC, "v0\n");
    editDoc(tabId, "refused\n");
    const guard = holdNextGuard();
    const request = handleWorkspaceSave("s-denied", { tabId }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(guard.held()).toBe(true));
    guard.release("outside the allowed roots");
    await request;

    expect(structuredErrorOf(responseTo("s-denied"))).toMatchObject({
      error: "INVALID_PATH",
      message: "outside the allowed roots",
    });
    expect(statefulFs.read(DOC)).toBe("v0\n");
    expect(await saveToPath(tabId, DOC, "after\n")).toBe(true);
    expect(statefulFs.read(DOC)).toBe("after\n");
  });
});

describe("workspace.save_as delayed in its preflight", () => {
  it("cannot override the path a later Save As chose, whichever finishes last", async () => {
    const tabId = await openDocInTab(DOC, "v0\n");
    editDoc(tabId, "text\n");
    const guard = holdNextGuard();
    const first = handleWorkspaceSaveAs("as-1", { tabId, filePath: FIRST }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(guard.held()).toBe(true));

    await handleWorkspaceSaveAs("as-2", { tabId, filePath: SECOND }, TEST_WRITE_CONTEXT);
    expect(doc(tabId).filePath).toBe(SECOND);
    guard.release();
    await first;

    expect(responseTo("as-2").success).toBe(true);
    expect(doc(tabId).filePath).toBe(SECOND);
    expect(tabPath(tabId)).toBe(SECOND);
  });

  it("a lone Save As still moves the tab", async () => {
    const tabId = await openDocInTab(DOC, "v0\n");
    editDoc(tabId, "text\n");

    await handleWorkspaceSaveAs("as-lone", { tabId, filePath: FIRST }, TEST_WRITE_CONTEXT);

    expect(responseTo("as-lone").success).toBe(true);
    expect(statefulFs.read(FIRST)).toBe("text\n");
    expect(doc(tabId).filePath).toBe(FIRST);
  });

  it("a refused Save As does not cost another save of the document its saved state", async () => {
    const tabId = await openDocInTab(DOC, "v0\n");
    editDoc(tabId, "text\n");
    const guard = holdNextGuard();
    const refused = handleWorkspaceSaveAs("as-denied", { tabId, filePath: FIRST }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(guard.held()).toBe(true));
    const earlier = saveToPath(tabId, DOC, "text\n");
    guard.release("outside the allowed roots");
    await Promise.all([refused, earlier]);

    expect(structuredErrorOf(responseTo("as-denied"))).toMatchObject({ error: "INVALID_PATH" });
    expect(doc(tabId).filePath).toBe(DOC);
    expect(doc(tabId).isDirty).toBe(false);
  });
});
