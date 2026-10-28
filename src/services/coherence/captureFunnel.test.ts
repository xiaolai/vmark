// @vitest-environment node
// WI-1.6 — coherence capture funnel: workspace-relative path resolution
// with prefix-boundary safety, fire-and-forget invoke of
// coherence_capture, pending-save registration for the kernel's identity
// rewrite (so the watcher swallows it), and silent degradation when
// coherence is unavailable (a failed capture never fails a save).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readInputsOf } from "@/test/mcpReadInputs";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockRegisterPendingSave = vi.fn(() => 42);
const mockClearPendingSave = vi.fn();
const mockClearPendingSaveAfterGrace = vi.fn();
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: (...args: unknown[]) => mockRegisterPendingSave(...args),
  clearPendingSave: (...args: unknown[]) => mockClearPendingSave(...args),
  clearPendingSaveAfterGrace: (...args: unknown[]) => mockClearPendingSaveAfterGrace(...args),
}));

import {
  captureAiEdit,
  captureExplorerNewFile,
  captureWrite,
  workspaceRelativePath,
} from "./captureFunnel";
import { captureMcpWrite, detachMcpReads, recordMcpRead } from "./mcpCapture";
import { mcpCoherenceAgent } from "./mcpActor";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";

const CONN = TEST_ATTRIBUTION.connectionId;
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";

function setCaptureOnSave(on: boolean) {
  useSettingsStore.getState().updateGeneralSetting("coherenceCaptureOnSave", on);
}

function setRoot(rootPath: string | null) {
  useWorkspaceStore.setState({ rootPath });
}

const receipt = {
  object: "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7",
  revision: `rev1:${"a".repeat(64)}`,
  entry_id: "018f3c7a-a001-7def-8a3c-1b2c3d4e5f60",
  content_with_identity: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  setRoot("/ws/story");
  setCaptureOnSave(false);
  mockInvoke.mockResolvedValue(receipt);
});

describe("workspaceRelativePath", () => {
  it.each([
    { root: "/ws/story", abs: "/ws/story/scene.md", expected: "scene.md" },
    { root: "/ws/story", abs: "/ws/story/ch1/scene.md", expected: "ch1/scene.md" },
    { root: "/ws/story/", abs: "/ws/story/scene.md", expected: "scene.md" },
    // Prefix-boundary trap: /ws/storyboard is NOT inside /ws/story.
    { root: "/ws/story", abs: "/ws/storyboard/scene.md", expected: null },
    { root: "/ws/story", abs: "/elsewhere/scene.md", expected: null },
    { root: "/ws/story", abs: "/ws/story", expected: null },
  ])("root=$root abs=$abs -> $expected", ({ root, abs, expected }) => {
    expect(workspaceRelativePath(root, abs)).toBe(expected);
  });
});

describe("captureWrite", () => {
  it("invokes coherence_capture with the workspace-relative path and defaults", async () => {
    const result = await captureWrite({
      absolutePath: "/ws/story/scene.md",
      content: "# Scene\n",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "manual save" },
    });
    expect(result).toEqual(receipt);
    expect(mockInvoke).toHaveBeenCalledWith("coherence_capture", {
      workspaceRoot: "/ws/story",
      request: {
        path: "scene.md",
        content: "# Scene\n",
        inputs: [],
        agent: { type: "human" },
        intent: { kind: "editor-save", summary: "manual save" },
        confidence: "exact",
        rewrite_identity: true,
        // Spec §5.1: minted once per logical operation, carried through
        // retries.
        idem: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
      // Capture-on-save ships off (WI-LX1.4).
      policy: "tracked-only",
    });
  });

  it("passes through inputs and inferred confidence for MCP writes", async () => {
    await captureWrite({
      absolutePath: "/ws/story/ch1.md",
      content: "x",
      inputs: [{ path: "elena.md", role: "direct" }],
      agent: mcpCoherenceAgent(TEST_ATTRIBUTION),
      intent: { kind: "mcp-document-write", summary: "document.write" },
      confidence: "inferred",
    });
    const [, args] = mockInvoke.mock.calls[0] as [string, { request: Record<string, unknown> }];
    expect(args.request.confidence).toBe("inferred");
    expect(args.request.inputs).toEqual([{ path: "elena.md", role: "direct" }]);
  });

  it("skips silently when no workspace is open", async () => {
    setRoot(null);
    const result = await captureWrite({
      absolutePath: "/ws/story/scene.md",
      content: "x",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "s" },
    });
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("skips files outside the workspace", async () => {
    const result = await captureWrite({
      absolutePath: "/elsewhere/notes.md",
      content: "x",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "s" },
    });
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("registers a pending save when the kernel rewrote the file with identity", async () => {
    const withIdentity = { ...receipt, content_with_identity: "---\nvmark:\n  id: x\n---\n# Scene\n" };
    mockInvoke.mockResolvedValue(withIdentity);
    await captureWrite({
      absolutePath: "/ws/story/scene.md",
      content: "# Scene\n",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "s" },
    });
    expect(mockRegisterPendingSave).toHaveBeenCalledWith(
      "/ws/story/scene.md",
      withIdentity.content_with_identity
    );
    // Kept for the grace window (pinned in utils/pendingSaves.test.ts), not
    // cleared at once: the watcher's echo of the kernel's rewrite arrives late.
    expect(mockClearPendingSave).not.toHaveBeenCalled();
    expect(mockClearPendingSaveAfterGrace).toHaveBeenCalledWith("/ws/story/scene.md", 42);
  });

  it("degrades silently when the kernel call fails", async () => {
    mockInvoke.mockRejectedValue(new Error("kernel unavailable"));
    const result = await captureWrite({
      absolutePath: "/ws/story/scene.md",
      content: "x",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "s" },
    });
    expect(result).toBeNull();
  });
});

describe("captureAiEdit", () => {
  function seedDoc(tabId: string, filePath: string | null, content: string) {
    useDocumentStore.getState().initDocument(tabId, content, filePath);
  }

  it("captures the buffer without a disk rewrite, self-input, exact when clean", async () => {
    seedDoc("tab-ai", "/ws/story/scene.md", "# Scene\napplied\n");
    await captureAiEdit({
      tabId: "tab-ai",
      modelId: "test-model",
      intentKind: "genie",
      summary: "Rewrite scene",
      bufferWasDirty: false,
    });
    expect(mockInvoke).toHaveBeenCalledWith("coherence_capture", {
      workspaceRoot: "/ws/story",
      request: {
        path: "scene.md",
        content: "# Scene\napplied\n",
        inputs: [{ path: "scene.md", role: "direct" }],
        agent: { type: "model", id: "test-model" },
        intent: { kind: "genie", summary: "Rewrite scene" },
        confidence: "exact",
        rewrite_identity: false,
        idem: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
      policy: "tracked-only",
    });
  });

  it("downgrades to inferred when the buffer was dirty before the apply", async () => {
    seedDoc("tab-dirty", "/ws/story/scene.md", "content");
    await captureAiEdit({
      tabId: "tab-dirty",
      intentKind: "ai-suggestion",
      summary: "accept",
      bufferWasDirty: true,
    });
    const [, args] = mockInvoke.mock.calls[0] as [string, { request: Record<string, unknown> }];
    expect(args.request.confidence).toBe("inferred");
  });

  it("skips untitled documents", async () => {
    seedDoc("tab-untitled", null, "draft");
    const result = await captureAiEdit({
      tabId: "tab-untitled",
      intentKind: "genie",
      summary: "s",
      bufferWasDirty: false,
    });
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("MCP session reads and writes", () => {
  it("consumed reads become inferred direct inputs, excluding the target", async () => {
    // recordMcpRead pins each read (coherence_head); only a pinned read is an
    // input (an unpinned one is pinned in mcpCapture.test.ts).
    mockInvoke.mockImplementation(async (cmd: unknown) =>
      cmd === "coherence_head" ? { object: receipt.object, revision: receipt.revision } : receipt
    );
    recordMcpRead(CONN, "/ws/story/elena.md");
    recordMcpRead(CONN, "/ws/story/timeline.md");
    recordMcpRead(CONN, "/elsewhere/outside.md"); // outside workspace: dropped
    recordMcpRead(CONN, "/ws/story/ch1.md"); // the write target itself: excluded
    await captureMcpWrite({
      absolutePath: "/ws/story/ch1.md",
      content: "chapter",
      toolName: "document.write",
      actor: TEST_ATTRIBUTION,
    });
    const captureCall = mockInvoke.mock.calls.find((c) => c[0] === "coherence_capture");
    const args = captureCall?.[1] as { request: Record<string, unknown> };
    expect(args.request.confidence).toBe("inferred");
    expect(args.request.agent).toEqual(mcpCoherenceAgent(TEST_ATTRIBUTION));
    const inputs = args.request.inputs as { path: string; role: string }[];
    expect(inputs.map((i) => i.path).sort()).toEqual(["elena.md", "timeline.md"]);
  });

  it("read set is consumed once per write", async () => {
    recordMcpRead(CONN, "/ws/story/elena.md");
    expect(readInputsOf(detachMcpReads(CONN), "/ws/story")).toHaveLength(1);
    expect(readInputsOf(detachMcpReads(CONN), "/ws/story")).toHaveLength(0);
  });
});

// WI-LX1.4 — every write path reaches the kernel through this funnel, and the
// funnel is where the capture-on-save setting is attached. The kernel enforces
// it (`coherence/capture_policy.rs`): `tracked-only` never creates `.vmark/` and
// never stamps a file; `adopt` is the opt-in behaviour.
describe("capture-on-save setting reaches the kernel on every write path", () => {
  function policySent(): unknown {
    const call = mockInvoke.mock.calls.find((c) => c[0] === "coherence_capture");
    return (call?.[1] as { policy?: unknown } | undefined)?.policy;
  }

  const paths: Array<{ name: string; run: () => Promise<unknown> }> = [
    {
      // Human save and history restore call captureWrite directly.
      name: "captureWrite (save, history restore)",
      run: () =>
        captureWrite({
          absolutePath: "/ws/story/scene.md",
          content: "x",
          agent: { type: "human" },
          intent: { kind: "editor-save", summary: "s" },
        }),
    },
    {
      name: "captureMcpWrite (MCP document.write / workspace.save)",
      run: () =>
        captureMcpWrite({
          absolutePath: "/ws/story/ch1.md",
          content: "c",
          toolName: "document.write",
          actor: TEST_ATTRIBUTION,
        }),
    },
    {
      name: "captureAiEdit (genie apply, accepted AI suggestion)",
      run: () => {
        useDocumentStore.getState().initDocument("tab-policy", "applied", "/ws/story/scene.md");
        return captureAiEdit({
          tabId: "tab-policy",
          intentKind: "genie",
          summary: "s",
          bufferWasDirty: false,
        });
      },
    },
    {
      name: "captureExplorerNewFile (explorer new file)",
      run: async () => {
        captureExplorerNewFile("/ws/story/new.md");
        await vi.waitFor(() => expect(policySent()).toBeDefined());
      },
    },
  ];

  it.each(paths)("$name sends tracked-only while the setting is OFF", async ({ run }) => {
    mockInvoke.mockImplementation(async (cmd: unknown) => (cmd === "coherence_head" ? null : receipt));
    await run();
    expect(policySent()).toBe("tracked-only");
  });

  it.each(paths)("$name sends adopt while the setting is ON", async ({ run }) => {
    setCaptureOnSave(true);
    mockInvoke.mockImplementation(async (cmd: unknown) => (cmd === "coherence_head" ? null : receipt));
    await run();
    expect(policySent()).toBe("adopt");
  });

  it("reads the setting at the write, not at an earlier one", async () => {
    await captureWrite({
      absolutePath: "/ws/story/a.md",
      content: "a",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "s" },
    });
    setCaptureOnSave(true);
    await captureWrite({
      absolutePath: "/ws/story/b.md",
      content: "b",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "s" },
    });
    const policies = mockInvoke.mock.calls
      .filter((c) => c[0] === "coherence_capture")
      .map((c) => (c[1] as { policy: string }).policy);
    expect(policies).toEqual(["tracked-only", "adopt"]);
  });

  it("a declined capture (null receipt) returns null and registers no pending save", async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await captureWrite({
      absolutePath: "/ws/story/scene.md",
      content: "x",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "s" },
    });
    expect(result).toBeNull();
    expect(mockRegisterPendingSave).not.toHaveBeenCalled();
  });
});
