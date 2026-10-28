// An MCP save that Rust refuses as superseded — a save asked for after it,
// from any document or window, already reached the file — is told so: workspace.save answers
// STALE naming the file, and document.write keeps its buffer update and
// reports the save as not written, with the same reason. Neither toasts.
// Edge cases: the document not marked missing, the buffer kept.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, doc, editDoc, openDocInTab } from "@/test/tier0/harness";
import { imeToast } from "@/services/ime/imeToast";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { resetBridge, responseTo, structuredErrorOf } from "./bridgeDiskHarness";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const DOC = `${ROOT}/notes.md`;

function writesSuperseded(): void {
  statefulFs.failWrites({
    code: "conflict",
    message: `A save made after this one already reached ${DOC}`,
    detail: { kind: "superseded", path: DOC, newest: 1 },
  });
}

let toasts: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  resetBridge();
  toasts = [
    vi.spyOn(imeToast, "error").mockImplementation(() => "id"),
    vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "id"),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a superseded MCP save", () => {
  it("workspace.save answers STALE, naming the file", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    editDoc(tabId, "after\n");
    writesSuperseded();

    await handleWorkspaceSave("req-sup", { tabId }, TEST_WRITE_CONTEXT);

    const err = structuredErrorOf(responseTo("req-sup"));
    expect(err).toMatchObject({ error: "STALE" });
    expect(err?.message).toContain(DOC);
    expect(err?.message).toContain("made after this one");
    expect(doc(tabId).isMissing).toBe(false);
    for (const toast of toasts) expect(toast).not.toHaveBeenCalled();
  });

  it("document.write keeps its buffer and reports the save not written", async () => {
    const tabId = await openDocInTab(DOC, "before\n");
    writesSuperseded();

    await handleDocumentWrite("req-sup-w", { tabId, content: "after\n" }, TEST_WRITE_CONTEXT);

    const r = responseTo("req-sup-w");
    expect(r.success).toBe(true);
    const data = r.data as { saved: boolean; save_error?: string };
    expect(data.saved).toBe(false);
    expect(data.save_error).toContain("made after this one");
    expect(doc(tabId).content).toBe("after\n");
    for (const toast of toasts) expect(toast).not.toHaveBeenCalled();
  });
});
