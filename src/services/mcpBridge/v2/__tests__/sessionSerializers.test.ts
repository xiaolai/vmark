// @vitest-environment node
// Round 3, #76 — the session serializers on their own: the protocol gate, kind
// detection, and the browser-tab / document-tab / window records, against the real
// stores. The composed payload stays pinned in session.test.ts.
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { BrowserTab, DocumentTab } from "@/stores/tabStoreTypes";
import {
  clientSupportsBrowserTabs,
  detectKind,
  serializeBrowserTab,
  serializeDocumentTab,
  serializeWindow,
} from "@/services/mcpBridge/v2/sessionSerializers";

const WORKFLOW_YAML = `name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useBrowserApprovalStore.setState({ attachments: [] });
  useSettingsStore.setState((s) => ({ general: { ...s.general, workspaceRailMode: false } }));
});

describe("clientSupportsBrowserTabs", () => {
  it.each(["0.3.0", "0.3", "0.4.1", "1.0.0", "10.0"])("accepts %s", (proto) => {
    expect(clientSupportsBrowserTabs(proto)).toBe(true);
  });
  it.each([undefined, "", "0.2.9", "0.2", "not-a-version", "0.3.", "0.3.0junk", "0.3e0.0", "3", "v0.3.0"])(
    "withholds browser tabs for %j (absent, older, or malformed — strict parse, fails safe)",
    (proto) => {
      expect(clientSupportsBrowserTabs(proto)).toBe(false);
    },
  );
});

describe("detectKind", () => {
  it("classifies by path first, then by content, else markdown", () => {
    expect(detectKind("/repo/.github/workflows/ci.yml", "")).toBe("yaml-workflow");
    expect(detectKind(null, WORKFLOW_YAML)).toBe("yaml-workflow");
    expect(detectKind("/notes.md", "# hello")).toBe("markdown");
    expect(detectKind(null, "")).toBe("markdown");
  });
});

describe("serializeBrowserTab", () => {
  it("lists an AI tab with its title and redacted url, and no attached flag", () => {
    const id = useTabStore.getState().createBrowserTab("main", "https://alice:secret@example.com/private?q=1", "Example", "ai-sandbox");
    useTabStore.getState().updateBrowserTab(id, { generation: 4 });
    const tab = useTabStore.getState().findTabById(id) as BrowserTab;
    expect(serializeBrowserTab(tab, true)).toEqual({
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

  it("lists an unattached human tab by id and origin only (X-02), and the page once attached", () => {
    const id = useTabStore.getState().createBrowserTab("main", "https://bank.example.com/reset/TOKEN-123?code=abc", "Reset your password", "human");
    useTabStore.getState().updateBrowserTab(id, { generation: 2 });
    const tab = useTabStore.getState().findTabById(id) as BrowserTab;
    const before = serializeBrowserTab(tab, false);
    expect(before).toEqual({
      id,
      kind: "browser",
      active: false,
      loading: false,
      generation: 2,
      automationMode: "human",
      attached: false,
      url: "https://bank.example.com",
    });
    expect(before).not.toHaveProperty("title");

    useBrowserApprovalStore.setState({ attachments: [{ tabId: id, generation: 2, once: false }] });
    expect(serializeBrowserTab(tab, false)).toMatchObject({
      attached: true,
      title: "Reset your password",
      url: "https://bank.example.com/reset/TOKEN-123",
    });
    // An attachment is per generation: one for another page does not open this one.
    useBrowserApprovalStore.setState({ attachments: [{ tabId: id, generation: 1, once: false }] });
    expect(serializeBrowserTab(tab, false)).toMatchObject({ attached: false, url: "https://bank.example.com" });
  });

  it("defaults the generation to 0 before the first commit", () => {
    const id = useTabStore.getState().createBrowserTab("main", "https://one.example/", "One", "ai-shared");
    const tab = useTabStore.getState().findTabById(id) as BrowserTab;
    expect(serializeBrowserTab(tab, false).generation).toBe(0);
  });
});

describe("serializeDocumentTab", () => {
  it("carries the detected kind (both spellings), dirty state, per-tab revision and the on-screen flags", () => {
    const id = useTabStore.getState().createTab("main", "/repo/.github/workflows/ci.yml");
    useDocumentStore.getState().initDocument(id, WORKFLOW_YAML, "/repo/.github/workflows/ci.yml");
    useRevisionStore.getState().setRevision(id, "rev-AAAAAAAA");
    const tab = useTabStore.getState().findTabById(id) as DocumentTab;
    expect(serializeDocumentTab(tab, true, false)).toEqual({
      id,
      kind: "yaml-workflow",
      documentKind: "yaml-workflow",
      filePath: "/repo/.github/workflows/ci.yml",
      title: tab.title,
      dirty: false,
      revision: "rev-AAAAAAAA",
      active: true,
      visible: false,
    });
  });

  it("reads an untitled tab with no document record as clean markdown", () => {
    const id = useTabStore.getState().createTab("main");
    const tab = useTabStore.getState().findTabById(id) as DocumentTab;
    expect(serializeDocumentTab(tab, false, true)).toMatchObject({
      kind: "markdown",
      filePath: null,
      dirty: false,
      active: false,
      visible: true,
    });
  });
});

describe("serializeWindow", () => {
  it("marks focus, reports a null instance with the rail off, and keeps tab order", () => {
    const doc = useTabStore.getState().createTab("main", "/a.md");
    const page = useTabStore.getState().createBrowserTab("main", "https://one.example/", "One", "ai-sandbox");
    const win = serializeWindow("main", "main", true);
    expect(win).toMatchObject({ label: "main", focused: true, activeWorkspaceInstanceId: null });
    expect(win.tabs.map((t) => [t.id, t.kind, t.active])).toEqual([
      [doc, "markdown", false],
      [page, "browser", true],
    ]);
    expect(serializeWindow("main", "settings", true).focused).toBe(false);
    expect(serializeWindow("main", null, true).focused).toBe(false);
  });

  it("withholds browser tabs from a client that does not understand them", () => {
    useTabStore.getState().createTab("main", "/a.md");
    useTabStore.getState().createBrowserTab("main", "https://one.example/", "One", "ai-sandbox");
    expect(serializeWindow("main", "main", false).tabs.map((t) => t.kind)).toEqual(["markdown"]);
  });

  it("reports an unknown window as empty rather than throwing", () => {
    expect(serializeWindow("ghost", "main", true)).toEqual({
      label: "ghost",
      focused: false,
      activeWorkspaceInstanceId: null,
      tabs: [],
    });
  });
});
