// vmark.workspace.save_as → coherence capture (WI-1.6, WI-LX1.4, audit #152).
// Save As was once the one MCP write path that never reached the capture
// funnel, so it recorded no provenance and ignored the capture-on-save setting.
//
// Only the Tauri boundary is mocked: the real handler, the real save pipeline
// and the REAL `captureMcpWrite` → `captureWrite` → `currentCapturePolicy`
// chain run, so these tests pin the policy that reaches the kernel. What the
// kernel then does with `tracked-only` in a workspace with no ledger (create
// nothing, stamp nothing) is pinned on the Rust side by
// `tracked_only_disk_write_in_a_fresh_workspace_creates_nothing`.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, editDoc, newUntitledTab, settle } from "@/test/tier0/harness";
import { useSettingsStore } from "@/stores/settingsStore";
import { hasPendingSave, matchesPendingSave } from "@/utils/pendingSaves";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";
import { captures, resetBridge, responseTo, type CaptureCall } from "./bridgeDiskHarness";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const TARGET = `${ROOT}/story/new.md`;

function setCaptureOnSave(on: boolean) {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({ general: { ...s.general, coherenceCaptureOnSave: on } });
}

function untitledWith(content: string): string {
  const tabId = newUntitledTab();
  editDoc(tabId, content);
  return tabId;
}

beforeEach(() => {
  resetBridge();
  statefulFs.mkdirp(`${ROOT}/story`);
});

describe("workspace.save_as follows the capture-on-save policy (#152)", () => {
  it("records the new file when capture-on-save is ON, and announces the kernel's rewrite", async () => {
    setCaptureOnSave(true);
    const stamped = "---\nvmark:\n  id: x\n---\nbody\n";
    statefulFs.stubCommand("coherence_capture", (args) => {
      captures.push(args as unknown as CaptureCall);
      return { object: "o", revision: "r", entry_id: "e", content_with_identity: stamped };
    });
    untitledWith("body\n");

    await handleWorkspaceSaveAs("req-1", { filePath: TARGET }, TEST_WRITE_CONTEXT);

    expect(responseTo("req-1").success).toBe(true);
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({
      workspaceRoot: ROOT,
      policy: "adopt",
      request: {
        path: "story/new.md",
        content: "body\n",
        confidence: "inferred",
        intent: { summary: "workspace.save_as" },
      },
    });
    // The kernel rewrote the file to insert its identity block; the watcher's
    // echo of THAT write must be recognised as ours too.
    await vi.waitFor(() => expect(matchesPendingSave(TARGET, stamped)).toBe(true));
  });

  it("with capture-on-save OFF and no ledger, the write is left alone", async () => {
    setCaptureOnSave(false);
    untitledWith("draft\n");

    await handleWorkspaceSaveAs("req-2", { filePath: TARGET }, TEST_WRITE_CONTEXT);

    expect(responseTo("req-2").success).toBe(true);
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0].policy).toBe("tracked-only");
    // Exactly the save itself hit the disk, and the only announced write is
    // that one — no identity rewrite.
    expect(statefulFs.writesTo(TARGET)).toEqual([
      { path: TARGET, content: "draft\n", via: "atomic_write_file" },
    ]);
    expect(matchesPendingSave(TARGET, "draft\n")).toBe(true);
  });

  it("a failed capture never fails the save", async () => {
    statefulFs.stubCommand("coherence_capture", () => {
      throw new Error("kernel down");
    });
    const tabId = untitledWith("x\n");

    await handleWorkspaceSaveAs("req-3", { tabId, filePath: TARGET }, TEST_WRITE_CONTEXT);

    expect(responseTo("req-3").success).toBe(true);
    expect(statefulFs.read(TARGET)).toBe("x\n");
  });

  it("does not capture when the disk write fails", async () => {
    statefulFs.failWrites(new Error("EACCES"));
    untitledWith("x\n");

    await handleWorkspaceSaveAs("req-4", { filePath: TARGET }, TEST_WRITE_CONTEXT);
    await settle();

    expect(responseTo("req-4").success).toBe(false);
    expect(captures).toEqual([]);
    expect(hasPendingSave(TARGET)).toBe(false);
  });

  it("does not capture when the path guard refuses", async () => {
    untitledWith("x\n");

    await handleWorkspaceSaveAs("req-5", { filePath: "/elsewhere/z.md" }, TEST_WRITE_CONTEXT);
    await settle();

    expect(responseTo("req-5").success).toBe(false);
    expect(statefulFs.has("/elsewhere/z.md")).toBe(false);
    expect(captures).toEqual([]);
  });
});
