// @vitest-environment jsdom
/**
 * useSlidevControls — the deck half of the Knowledge Base controls.
 *
 * Split out of `useContentServer.test.ts` (test file-size gate) alongside the
 * hook it exercises. Driven THROUGH `useContentServer`, which mounts it, so the
 * composition the app actually uses is what is under test.
 *
 * Two round-2 properties live here:
 *   - a deck failure is an ACTION failure, reported as a toast, never a
 *     transition of the SERVER's lifecycle status (#758), and
 *   - each control is single-flight (#756).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const startContentServer = vi.fn();
const stopContentServer = vi.fn();
const openKbInBrowser = vi.fn();
const getKbAuthUrl = vi.fn();
const getContentServerStatus = vi.fn();
const startSlidevPreview = vi.fn();
const exportSlidev = vi.fn();
vi.mock("@/services/contentServer", () => ({
  startContentServer: (...a: unknown[]) => startContentServer(...a),
  stopContentServer: (...a: unknown[]) => stopContentServer(...a),
  openKbInBrowser: (...a: unknown[]) => openKbInBrowser(...a),
  getKbAuthUrl: (...a: unknown[]) => getKbAuthUrl(...a),
  getContentServerStatus: (...a: unknown[]) => getContentServerStatus(...a),
  startSlidevPreview: (...a: unknown[]) => startSlidevPreview(...a),
  exportSlidev: (...a: unknown[]) => exportSlidev(...a),
}));

const toastErrorMock = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...a: unknown[]) => toastErrorMock(...a), info: vi.fn(), success: vi.fn() },
}));

const openUrlMock = vi.fn();
const saveMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrlMock(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => saveMock(...a) }));

/** Seed the REAL tab store — `lint:mock-boundaries` forbids mocking a store,
 *  and `findTabById`/`tabFilePath` are ordinary reads over seeded state. */
function seedTab(tab: Partial<DocumentTab> & { id: string }): void {
  useTabStore.setState({
    tabs: {
      main: [
        {
          kind: "document",
          title: "deck.md",
          isPinned: false,
          formatId: "markdown",
          filePath: "/ws/deck.md",
          ...tab,
        } as DocumentTab,
      ],
    },
    activeTabId: { main: tab.id },
  });
}
vi.mock("@/services/navigation/activeDocument", () => ({ getActiveTabId: () => "t1" }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(vi.fn()),
}));

import { useContentServer } from "./useContentServer";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  startContentServer.mockReset();
  stopContentServer.mockReset();
  openKbInBrowser.mockReset();
  getKbAuthUrl.mockReset().mockResolvedValue("http://127.0.0.1:7/__auth?t=n");
  getContentServerStatus.mockReset().mockResolvedValue(null);
  startSlidevPreview.mockReset();
  exportSlidev.mockReset();
  openUrlMock.mockReset();
  saveMock.mockReset();
  toastErrorMock.mockReset();
  seedTab({ id: "t1", filePath: "/ws/deck.md" });
  useContentServerStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSlidevControls (through useContentServer)", () => {
  it("previewSlides starts a Slidev preview for the active deck and opens it", async () => {
    startSlidevPreview.mockResolvedValue("http://127.0.0.1:7/__auth?t=n&next=/slidev/");
    openUrlMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.previewSlides();
    });
    expect(startSlidevPreview).toHaveBeenCalledWith("/ws", "/ws/deck.md");
    expect(openUrlMock).toHaveBeenCalledWith("http://127.0.0.1:7/__auth?t=n&next=/slidev/");
    expect(useContentServerStore.getState().slidevDeckPath).toBe("/ws/deck.md");
  });

  it("exportSlides prompts for a path and exports the deck to PDF", async () => {
    saveMock.mockResolvedValue("/out/deck.pdf");
    exportSlidev.mockResolvedValue("/out/deck.pdf");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(saveMock).toHaveBeenCalled();
    expect(exportSlidev).toHaveBeenCalledWith("/ws", "/ws/deck.md", "pdf", "/out/deck.pdf");
  });

  it("exportSlides derives PPTX format from the chosen path", async () => {
    saveMock.mockResolvedValue("/out/deck.pptx");
    exportSlidev.mockResolvedValue("/out/deck.pptx");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(exportSlidev).toHaveBeenCalledWith("/ws", "/ws/deck.md", "pptx", "/out/deck.pptx");
  });

  // Audit 20260907 (#361): an unknown extension silently selected PDF while
  // keeping the chosen filename, so PDF bytes could land in `deck.docx`.
  it("exportSlides refuses an output path whose extension is not a supported format", async () => {
    saveMock.mockResolvedValue("/ws/deck.docx");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(exportSlidev).not.toHaveBeenCalled();
    // Reported as a TOAST (audit #758): a bad output extension is a failure of
    // the export ACTION, and moving the SERVER's lifecycle status to "error"
    // for it both misdescribed a healthy server and stopped
    // useContentServerWorkspaceSync — which acts only on "running" — from
    // restarting it on a later trust flip.
    expect(useContentServerStore.getState().status).not.toBe("error");
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it("exportSlides is a no-op when the save dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(exportSlidev).not.toHaveBeenCalled();
  });

  it("exportSlides surfaces a save-dialog failure instead of rejecting", async () => {
    // The native dialog can throw (permission denied, macOS dialog failure).
    // The control must REPORT it, not reject at the call site where the caller
    // is a fire-and-forget click handler.
    saveMock.mockRejectedValue(new Error("dialog exploded"));
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await expect(result.current.exportSlides()).resolves.toBeUndefined();
    });
    expect(exportSlidev).not.toHaveBeenCalled();
    expect(toastErrorMock.mock.calls.flat().join(" ")).toContain("dialog exploded");
    expect(useContentServerStore.getState().status).not.toBe("error");
  });

  it("previewSlides reports a missing deck without touching the server status", async () => {
    seedTab({ id: "t1", filePath: null });
    useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.previewSlides();
    });
    expect(startSlidevPreview).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    // A running server stays running: "no deck is open" says nothing about it.
    expect(useContentServerStore.getState().status).toBe("running");
  });

  // The SYMMETRIC half (audit #757). Both controls now share one envelope
  // (`runDeckOperation`); with only the preview side asserted, a copy of that
  // envelope could drift back into the export path — reporting a missing deck
  // through `setError`, or not at all — and every test would still pass.
  it("exportSlides reports a missing deck the same way, without touching the server status", async () => {
    seedTab({ id: "t1", filePath: null });
    useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(saveMock).not.toHaveBeenCalled();
    expect(exportSlidev).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(useContentServerStore.getState().status).toBe("running");
  });

  // A refused re-entry must be SILENT: the first click is still running, so a
  // second one has nothing to report. Pins the one place the guard is checked.
  it("a dropped second exportSlides click reports nothing", async () => {
    saveMock.mockResolvedValue("/out/deck.pdf");
    let release: ((p: string) => void) | undefined;
    exportSlidev.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useContentServer());
    let first: Promise<void> | undefined;
    await act(async () => {
      first = result.current.exportSlides();
    });
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
    await act(async () => {
      release?.("/out/deck.pdf");
      await first;
    });
  });

  // audit #756 — both controls sit behind buttons, so a second click while the
  // first call is still resolving is a real input, not a hypothetical.
  it("previewSlides is single-flight: a second click while one is in flight is dropped", async () => {
    let release: ((url: string) => void) | undefined;
    startSlidevPreview.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useContentServer());
    let first: Promise<void> | undefined;
    await act(async () => {
      first = result.current.previewSlides();
    });
    await act(async () => {
      await result.current.previewSlides();
    });
    expect(startSlidevPreview).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.("http://127.0.0.1:7/slidev/");
      await first;
    });
    // …and the guard is released, so the next click works.
    startSlidevPreview.mockResolvedValue("http://127.0.0.1:7/slidev/");
    await act(async () => {
      await result.current.previewSlides();
    });
    expect(startSlidevPreview).toHaveBeenCalledTimes(2);
  });

  it("exportSlides is single-flight: two exports cannot race one output path", async () => {
    saveMock.mockResolvedValue("/out/deck.pdf");
    let release: ((p: string) => void) | undefined;
    exportSlidev.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useContentServer());
    let first: Promise<void> | undefined;
    await act(async () => {
      first = result.current.exportSlides();
    });
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(exportSlidev).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.("/out/deck.pdf");
      await first;
    });
  });
});
