// WI-1.4 — vmark.workflow.{apply_patch, validate}.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/revisionStore";
import {
  handleWorkflowApplyPatch,
  handleWorkflowValidate,
} from "../workflow";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

vi.mock("@/lib/ghaWorkflow/lint/actionlint", () => ({
  lintWithActionlint: vi.fn(async () => ({
    binaryAvailable: true,
    diagnostics: [],
  })),
}));

vi.mock("@/stores/mcpCheckpointPersistence", () => ({
  appendCheckpoint: vi.fn(async () => undefined),
}));

import { respond } from "../../utils";
import { lintWithActionlint } from "@/lib/ghaWorkflow/lint/actionlint";
import { useMcpCheckpointStore } from "@/stores/mcpCheckpointStore";

const WORKFLOW = `name: ci
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

function resetStores() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
  useMcpCheckpointStore.setState({ checkpoints: [], hydrated: false });
}

function seedWorkflowTab(tabId = "t-yaml") {
  useTabStore.setState({
    tabs: {
      main: [
        {
          id: tabId,
          filePath: "/repo/.github/workflows/ci.yml",
          title: "ci",
          isPinned: false,
        },
      ],
    },
    activeTabId: { main: tabId },
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore
    .getState()
    .initDocument(tabId, WORKFLOW, "/repo/.github/workflows/ci.yml");
}

function lastRespond() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

function parseStructuredError(s: string | undefined) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

describe("vmark.workflow.apply_patch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("renames a workflow via workflow.set patch", async () => {
    seedWorkflowTab();
    await handleWorkflowApplyPatch("req-1", {
      patches: [{ kind: "workflow.set", path: "name", value: "renamed" }],
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    const content = useDocumentStore.getState().documents["t-yaml"].content;
    expect(content).toMatch(/^name: renamed/);
  });

  it("rejects non-array patches with INVALID_PATCH", async () => {
    seedWorkflowTab();
    await handleWorkflowApplyPatch("req-2", { patches: "not-array" });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_PATCH",
    });
  });

  it("rejects unknown patch kinds with INVALID_PATCH", async () => {
    seedWorkflowTab();
    await handleWorkflowApplyPatch("req-3", {
      patches: [{ kind: "unknown.thing", value: "x" }],
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_PATCH",
    });
  });

  it("returns NOT_WORKFLOW for a markdown tab", async () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-md",
            filePath: "/tmp/notes.md",
            title: "notes",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-md" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-md", "# hi", "/tmp/notes.md");

    await handleWorkflowApplyPatch("req-4", {
      patches: [{ kind: "workflow.set", path: "name", value: "ci" }],
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NOT_WORKFLOW",
    });
  });

  it("returns STALE when expected_revision does not match current", async () => {
    seedWorkflowTab();
    await handleWorkflowApplyPatch("req-5", {
      expected_revision: "rev-IMPOSSIBLE",
      patches: [{ kind: "workflow.set", path: "name", value: "x" }],
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({ error: "STALE" });
  });

  it("does not bump revision when patches produce no change", async () => {
    seedWorkflowTab();
    const before = useRevisionStore.getState().getRevision();
    // workflow.set with same value as the existing one — no-op.
    await handleWorkflowApplyPatch("req-6", {
      patches: [{ kind: "workflow.set", path: "name", value: "ci" }],
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useRevisionStore.getState().getRevision()).toBe(before);
    expect(useMcpCheckpointStore.getState().checkpoints).toHaveLength(0);
  });

  it("pushes a checkpoint after a successful patch batch", async () => {
    seedWorkflowTab();
    await handleWorkflowApplyPatch("req-cp", {
      patches: [
        { kind: "workflow.set", path: "name", value: "renamed" },
      ],
    });
    const cps = useMcpCheckpointStore.getState().list({
      filePath: "/repo/.github/workflows/ci.yml",
    });
    expect(cps).toHaveLength(1);
    expect(cps[0]).toMatchObject({
      tool: "workflow.apply_patch",
      filePath: "/repo/.github/workflows/ci.yml",
    });
    expect(cps[0].description).toContain("workflow name");
    expect(cps[0].contentBefore).toBe(WORKFLOW);
  });
});

describe("vmark.workflow.validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("forwards actionlint diagnostics with a clean shape", async () => {
    seedWorkflowTab();
    vi.mocked(lintWithActionlint).mockResolvedValueOnce({
      binaryAvailable: true,
      diagnostics: [
        {
          severity: "warning",
          code: "GHA-ACTIONLINT-syntax-check" as never,
          message: "missing 'on' key",
          position: { startLine: 3, startCol: 1, endLine: 3, endCol: 5 },
        },
      ],
    });

    await handleWorkflowValidate("req-v", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      ok: false,
      diagnostics: [
        {
          line: 3,
          col: 1,
          message: "missing 'on' key",
          severity: "warning",
        },
      ],
    });
  });

  it("returns ok:true when actionlint reports zero diagnostics", async () => {
    seedWorkflowTab();
    await handleWorkflowValidate("req-clean", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("returns NOT_WORKFLOW for a markdown tab", async () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-md2",
            filePath: "/tmp/x.md",
            title: "x",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-md2" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-md2", "# hi", "/tmp/x.md");
    await handleWorkflowValidate("req-not", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NOT_WORKFLOW",
    });
  });
});
