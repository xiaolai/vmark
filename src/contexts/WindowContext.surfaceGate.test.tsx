/**
 * The document surface waits for the window's announcement — on every path
 * the REAL provider reaches `markReady` by, under StrictMode as dev builds run.
 */
// WI-OC1.3 — building a large document's view is seconds of main-thread work
// on a slow machine. Started before the window announced itself, it starved
// the menu and close listeners the announcement waits on, and the window gave
// up with "menu commands did not mount within 5000ms" (#1565). Each init path
// below calls `markReady` from a different place, so each is pinned.
import { StrictMode, useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { emit, claimWorkspaceTransfer, handleTabTransfer, prepareStorage } = vi.hoisted(() => ({
  emit: vi.fn((_event: string, _payload?: unknown) => Promise.resolve()),
  claimWorkspaceTransfer: vi.fn(async () => false),
  handleTabTransfer: vi.fn(async () => false),
  prepareStorage: vi.fn(),
}));
let label = "main";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label, emit, listen: () => Promise.resolve(() => {}) }),
}));
vi.mock("./prepareWindowStorage", () => ({ prepareWindowStorage: prepareStorage }));
vi.mock("@/services/workspaces/workspaceWindowActions", () => ({
  claimWorkspaceTransferForWindow: claimWorkspaceTransfer,
}));
vi.mock("./tabTransferHandlers", () => ({
  handleTabTransfer,
  applyTabTransferData: vi.fn(),
  handleTabRemovalRequest: vi.fn(),
}));
vi.mock("./startupFileOpen", () => ({
  openStartupContent: vi.fn(async () => {}),
  parseStartupFilesParam: () => [],
}));
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: vi.fn(async () => null),
}));
vi.mock("@/services/workspaces/workspaceAccess", () => ({ regrantWorkspaceAccess: vi.fn(async () => {}) }));
vi.mock("@/services/persistence/windowBrowserSession", () => ({ restoreWindowBrowserSession: vi.fn() }));
vi.mock("@/hooks/useWorkspaceSync", () => ({ useWorkspaceSync: vi.fn() }));

/** What the window's ready attribute said each time an editor mounted. */
const surfaceMounts: (string | null)[] = [];
vi.mock("@/components/Editor/Editor", () => ({
  Editor: function SurfaceProbe() {
    useEffect(() => {
      surfaceMounts.push(document.documentElement.getAttribute(READY_ATTRIBUTE));
    }, []);
    return <div data-testid="surface" />;
  },
}));

import { WindowProvider } from "./WindowContext";
import { READY_ATTRIBUTE } from "./useWindowReady";
import { resetWindowListeningForTest } from "./windowListening";
import { DocumentSplitContainer } from "@/components/Editor/DocumentSplit/DocumentSplitContainer";
import { resetMenuCommandsForTest, signalMenuCommandsMounted } from "@/services/commands/menuCommandsReady";
import {
  resetCloseListenersForTest,
  signalCloseListenersMounted,
} from "@/services/windowClose/closeListenersReady";
import { useTabStore } from "@/stores/tabStore";

function renderWindow() {
  render(
    <StrictMode>
      <WindowProvider>
        <div data-testid="shell" />
        <DocumentSplitContainer />
      </WindowProvider>
    </StrictMode>,
  );
}

/** What the window's own listeners report once they are registered. */
async function listenersMount() {
  await act(async () => {
    signalMenuCommandsMounted(true);
    signalCloseListenersMounted(true);
    await Promise.resolve();
  });
}

beforeEach(() => {
  label = "main";
  surfaceMounts.length = 0;
  emit.mockClear();
  claimWorkspaceTransfer.mockReset().mockResolvedValue(false);
  handleTabTransfer.mockReset().mockResolvedValue(false);
  prepareStorage.mockReset();
  resetMenuCommandsForTest();
  resetCloseListenersForTest();
  resetWindowListeningForTest();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  document.documentElement.removeAttribute(READY_ATTRIBUTE);
});

afterEach(() => {
  document.documentElement.removeAttribute(READY_ATTRIBUTE);
});

describe("the document surface waits for the window's announcement", () => {
  it.each([
    ["a launch window with nothing to restore", () => {}],
    ["a document window that already has tabs", () => {
      label = "doc-1";
      useTabStore.getState().createTab("doc-1", null);
    }],
    ["a window that claims a workspace transfer", () => {
      label = "doc-2";
      claimWorkspaceTransfer.mockResolvedValue(true);
    }],
    ["a window that claims a tab transfer", () => {
      label = "doc-3";
      handleTabTransfer.mockResolvedValue(true);
    }],
    ["a window whose init fails", () => {
      prepareStorage.mockImplementation(() => {
        throw new Error("storage boom");
      });
    }],
  ])("%s", async (_name, arrange) => {
    arrange();
    renderWindow();

    // The provider is ready and its children render — the surface is not.
    await screen.findByTestId("shell");
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("surface")).toBeNull();
    expect(emit).not.toHaveBeenCalled();

    await listenersMount();

    await screen.findByTestId("surface");
    expect(emit).toHaveBeenCalledExactlyOnceWith("ready", label);
    // Every mount saw the announcement already made.
    expect(surfaceMounts.length).toBeGreaterThan(0);
    expect(surfaceMounts.every((attr) => attr === "true")).toBe(true);
  });
});

describe("a window with no document surface still announces itself", () => {
  it.each(["settings", "pdf-export"])("%s, after StrictMode's replay cleared its timer", async (name) => {
    label = name;
    renderWindow();

    await waitFor(() => expect(emit).toHaveBeenCalledExactlyOnceWith("ready", name));
    expect(document.documentElement.getAttribute(READY_ATTRIBUTE)).toBe("true");
  });
});
