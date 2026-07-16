// WI-1.4 — vmark.session.get_state shape and tab-kind discrimination.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/documentStore";
import { handleSessionGetState, buildSessionState } from "../session";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
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
    expect(state.capabilities.mcpProtocol).toBe("0.3.0");
  });

  it("classifies a markdown tab as kind=markdown", () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            kind: "document",
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
    expect(state.windows[0].tabs[0]).toMatchObject({ kind: "markdown", documentKind: "markdown" });
    expect(state.windows[0].tabs[0].filePath).toBe("/tmp/notes.md");
  });

  it("classifies a workflow YAML tab via path heuristic", () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            kind: "document",
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
    expect(state.windows[0].tabs[0]).toMatchObject({ kind: "yaml-workflow", documentKind: "yaml-workflow" });
  });

  it("classifies an unsaved workflow YAML via shape heuristic", () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            kind: "document",
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
    expect(state.windows[0].tabs[0]).toMatchObject({ kind: "yaml-workflow", documentKind: "yaml-workflow" });
    expect(state.windows[0].tabs[0].filePath).toBeNull();
  });

  it("includes each tab's own revision (per-tab, WI-0.10)", () => {
    useTabStore.setState({
      tabs: {
        main: [
          { kind: "document", id: "t1", filePath: null, title: "A", isPinned: false },
          { kind: "document", id: "t2", filePath: null, title: "B", isPinned: false },
        ],
      },
      activeTabId: { main: "t1" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t1", "A", null);
    useDocumentStore.getState().initDocument("t2", "B", null);
    // Distinct revisions per tab.
    useRevisionStore.getState().setRevision("t1", "rev-AAAAAAAA");
    useRevisionStore.getState().setRevision("t2", "rev-BBBBBBBB");

    const state = buildSessionState("0.7.0");
    expect(state.windows[0].tabs[0].revision).toBe("rev-AAAAAAAA");
    expect(state.windows[0].tabs[1].revision).toBe("rev-BBBBBBBB");
  });

  it("includes browser tabs with redacted URLs and stable automation metadata", () => {
    const id = useTabStore.getState().createBrowserTab(
      "main",
      "https://alice:secret@example.com/private",
      "Example",
      "ai-sandbox",
    );
    useTabStore.getState().updateBrowserTab(id, { generation: 4 });
    const state = buildSessionState("0.7.0", "0.3.0");
    expect(state.windows[0].tabs).toContainEqual({
      id,
      kind: "browser",
      active: true,
      title: "Example",
      url: "https://example.com/private",
      loading: false,
      generation: 4,
      automationMode: "ai-sandbox",
    });
  });

  it("marks only the focused browser webpage active while enumerating every page", () => {
    const first = useTabStore.getState().createBrowserTab(
      "main",
      "https://one.example",
      "One",
    );
    const second = useTabStore.getState().createBrowserPage(
      "main",
      "https://two.example",
      "Two",
    );

    const state = buildSessionState("0.7.0", "0.3.0");
    expect(state.windows[0].tabs).toEqual([
      expect.objectContaining({ id: first, kind: "browser", active: false }),
      expect.objectContaining({ id: second, kind: "browser", active: true }),
    ]);
  });

  describe("browser-tab protocol gating", () => {
    beforeEach(() => {
      useTabStore.getState().createBrowserTab("main", "https://example.com/", "Ex");
      useTabStore.setState({
        tabs: {
          main: [
            { kind: "document", id: "doc", filePath: "/a.md", title: "a", isPinned: false },
            ...useTabStore.getState().tabs.main!.filter((t) => t.kind === "browser"),
          ],
        },
      });
    });

    it("omits browser tabs when the client declares no protocol (pre-0.3)", () => {
      const state = buildSessionState("0.7.0");
      expect(state.windows[0].tabs.every((t) => t.kind !== "browser")).toBe(true);
      expect(state.windows[0].tabs.some((t) => t.kind === "markdown")).toBe(true);
    });

    it("omits browser tabs for a pre-0.3 client protocol", () => {
      const state = buildSessionState("0.7.0", "0.2.0");
      expect(state.windows[0].tabs.every((t) => t.kind !== "browser")).toBe(true);
    });

    it("includes browser tabs for a 0.3.0+ client protocol", () => {
      expect(buildSessionState("0.7.0", "0.3.0").windows[0].tabs.some((t) => t.kind === "browser")).toBe(true);
      expect(buildSessionState("0.7.0", "1.0.0").windows[0].tabs.some((t) => t.kind === "browser")).toBe(true);
    });

    it.each(["not-a-version", "0.3.", "0.3.0junk", "0.3e0.0", "", "3", "v0.3.0"])(
      "omits browser tabs for the malformed protocol %j (strict parse, fails safe)",
      (proto) => {
        const state = buildSessionState("0.7.0", proto);
        expect(state.windows[0].tabs.every((t) => t.kind !== "browser")).toBe(true);
      },
    );

    it("handleSessionGetState gates on the request's clientProtocol arg", async () => {
      await handleSessionGetState("req-old", "0.7.0", {});
      const oldData = vi.mocked(respond).mock.calls.at(-1)![0].data as { windows: { tabs: { kind: string }[] }[] };
      expect(oldData.windows[0].tabs.every((t) => t.kind !== "browser")).toBe(true);

      await handleSessionGetState("req-new", "0.7.0", { clientProtocol: "0.3.0" });
      const newData = vi.mocked(respond).mock.calls.at(-1)![0].data as { windows: { tabs: { kind: string }[] }[] };
      expect(newData.windows[0].tabs.some((t) => t.kind === "browser")).toBe(true);
    });
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
