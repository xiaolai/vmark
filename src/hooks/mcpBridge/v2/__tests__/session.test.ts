// WI-1.4 — vmark.session.get_state shape and tab-kind discrimination.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/revisionStore";
import { handleSessionGetState, buildSessionState } from "../session";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { respond } from "../../utils";

const WORKFLOW_YAML = `name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;

function resetStores() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
}

describe("vmark.session.get_state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("returns a session state with empty windows when no tabs are open", () => {
    const state = buildSessionState("0.7.0");
    expect(state.windows).toEqual([]);
    expect(state.capabilities.version).toBe("0.7.0");
    expect(state.capabilities.supportedKinds).toEqual([
      "markdown",
      "yaml-workflow",
    ]);
    expect(state.capabilities.mcpProtocol).toBe("0.1.0");
  });

  it("classifies a markdown tab as kind=markdown", () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "tab-1",
            filePath: "/tmp/notes.md",
            title: "notes",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument(
      "tab-1",
      "# hello world",
      "/tmp/notes.md",
    );

    const state = buildSessionState("0.7.0");
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0].label).toBe("main");
    expect(state.windows[0].focused).toBe(true);
    expect(state.windows[0].tabs[0].kind).toBe("markdown");
    expect(state.windows[0].tabs[0].filePath).toBe("/tmp/notes.md");
  });

  it("classifies a workflow YAML tab via path heuristic", () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "tab-w",
            filePath: "/repo/.github/workflows/ci.yml",
            title: "ci",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "tab-w" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore
      .getState()
      .initDocument("tab-w", WORKFLOW_YAML, "/repo/.github/workflows/ci.yml");

    const state = buildSessionState("0.7.0");
    expect(state.windows[0].tabs[0].kind).toBe("yaml-workflow");
  });

  it("classifies an unsaved workflow YAML via shape heuristic", () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "tab-u",
            filePath: null,
            title: "Untitled",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "tab-u" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("tab-u", WORKFLOW_YAML, null);

    const state = buildSessionState("0.7.0");
    expect(state.windows[0].tabs[0].kind).toBe("yaml-workflow");
    expect(state.windows[0].tabs[0].filePath).toBeNull();
  });

  it("includes the current revision in every tab", () => {
    useTabStore.setState({
      tabs: {
        main: [
          { id: "t1", filePath: null, title: "A", isPinned: false },
          { id: "t2", filePath: null, title: "B", isPinned: false },
        ],
      },
      activeTabId: { main: "t1" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t1", "A", null);
    useDocumentStore.getState().initDocument("t2", "B", null);

    const expected = useRevisionStore.getState().getRevision();
    const state = buildSessionState("0.7.0");
    expect(state.windows[0].tabs[0].revision).toBe(expected);
    expect(state.windows[0].tabs[1].revision).toBe(expected);
  });

  it("handleSessionGetState calls respond with the structured payload", async () => {
    await handleSessionGetState("req-x", "0.7.0");
    expect(respond).toHaveBeenCalledTimes(1);
    const call = vi.mocked(respond).mock.calls[0][0];
    expect(call.id).toBe("req-x");
    expect(call.success).toBe(true);
    expect(call.data).toMatchObject({
      windows: expect.any(Array),
      capabilities: expect.objectContaining({ version: "0.7.0" }),
    });
  });
});
