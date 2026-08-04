/**
 * Tests for cleanupBeforeModeSwitch.
 *
 * Single source of truth for cleanup between source ↔ WYSIWYG mode switches,
 * called from keyboard shortcut and menu event paths alike. Regression here
 * corrupts both interaction paths, so the try/catch boundary and the
 * always-flush ordering both need explicit coverage.
 *
 * WI-9 (plan-20260803-161713): uses the REAL popup stores — the registered
 * popups all close through the one uniform per-store API, verified on store
 * state, not call args.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockHideImagePreview, mockFlushActiveWysiwygNow } = vi.hoisted(() => ({
  mockHideImagePreview: vi.fn(),
  mockFlushActiveWysiwygNow: vi.fn(),
}));

vi.mock("@/plugins/imagePreview/ImagePreviewView", () => ({
  hideImagePreview: (...args: unknown[]) => mockHideImagePreview(...args),
}));

vi.mock("@/utils/wysiwygFlush", () => ({
  flushActiveWysiwygNow: (...args: unknown[]) => mockFlushActiveWysiwygNow(...args),
}));

import { cleanupBeforeModeSwitch } from "./modeSwitchCleanup";
import { useEditorContextMenuStore } from "@/stores/editorContextMenuStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

const anchorRect = { top: 1, left: 2, bottom: 3, right: 4 };

function contextSnapshot(): EditorContextMenuSnapshot {
  return {
    surface: "wysiwyg",
    selectionEmpty: true,
    inCodeBlock: false,
    headingLevel: null,
    listType: null,
    inBlockquote: false,
    link: null,
    formatPolicy: { paragraphFormatting: true, insertBlockActions: true },
    activeActions: [],
    disabledActions: [],
  };
}

/** Open all three registered popups through their real public APIs. */
function openAllRegisteredPopups(callbacks?: {
  onConfirm?: () => void;
  onDismiss?: () => void;
}) {
  useImagePasteToastStore.getState().showToast({
    imagePath: "img.png",
    imageType: "url",
    anchorRect,
    editorDom: document.createElement("div"),
    onConfirm: callbacks?.onConfirm ?? vi.fn(),
    onDismiss: callbacks?.onDismiss ?? vi.fn(),
  });
  useEditorContextMenuStore.getState().openMenu({
    position: { x: 1, y: 2 },
    snapshot: contextSnapshot(),
  });
  useMediaPopupStore.getState().openPopup({
    mediaSrc: "clip.mp4",
    mediaNodePos: 5,
    mediaNodeType: "block_video",
    anchorRect,
  });
}

beforeEach(() => {
  mockHideImagePreview.mockReset();
  mockFlushActiveWysiwygNow.mockReset();
  useImagePasteToastStore.setState(useImagePasteToastStore.getInitialState());
  useEditorContextMenuStore.setState(useEditorContextMenuStore.getInitialState());
  useMediaPopupStore.setState(useMediaPopupStore.getInitialState());
});

describe("cleanupBeforeModeSwitch", () => {
  it("closes ALL registered popups, verified on each store's state", () => {
    openAllRegisteredPopups();

    cleanupBeforeModeSwitch();

    expect(useImagePasteToastStore.getState().isOpen).toBe(false);
    expect(useImagePasteToastStore.getState().imagePath).toBe("");
    expect(useImagePasteToastStore.getState().onConfirm).toBeNull();
    expect(useEditorContextMenuStore.getState().isOpen).toBe(false);
    expect(useEditorContextMenuStore.getState().position).toBeNull();
    expect(useEditorContextMenuStore.getState().snapshot).toBeNull();
    expect(useMediaPopupStore.getState().isOpen).toBe(false);
    expect(useMediaPopupStore.getState().mediaSrc).toBe("");
    expect(useMediaPopupStore.getState().mediaNodePos).toBe(-1);
  });

  it("is idempotent: running twice leaves the same closed state", () => {
    openAllRegisteredPopups();

    cleanupBeforeModeSwitch();
    const afterFirst = {
      toast: useImagePasteToastStore.getState(),
      menu: useEditorContextMenuStore.getState(),
      media: useMediaPopupStore.getState(),
    };

    cleanupBeforeModeSwitch();

    // Second run must not re-write any store: identical state references.
    expect(useImagePasteToastStore.getState()).toBe(afterFirst.toast);
    expect(useEditorContextMenuStore.getState()).toBe(afterFirst.menu);
    expect(useMediaPopupStore.getState()).toBe(afterFirst.media);
    expect(useImagePasteToastStore.getState().isOpen).toBe(false);
    expect(useEditorContextMenuStore.getState().isOpen).toBe(false);
    expect(useMediaPopupStore.getState().isOpen).toBe(false);
  });

  it("with zero popups open it touches no store state (no subscriber wake)", () => {
    const before = {
      toast: useImagePasteToastStore.getState(),
      menu: useEditorContextMenuStore.getState(),
      media: useMediaPopupStore.getState(),
    };

    cleanupBeforeModeSwitch();

    expect(useImagePasteToastStore.getState()).toBe(before.toast);
    expect(useEditorContextMenuStore.getState()).toBe(before.menu);
    expect(useMediaPopupStore.getState()).toBe(before.media);
  });

  it("closing the toast does NOT invoke its callbacks (legacy hideToast semantics)", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    openAllRegisteredPopups({ onConfirm, onDismiss });

    cleanupBeforeModeSwitch();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("always flushes WYSIWYG regardless of popup state", () => {
    cleanupBeforeModeSwitch();
    expect(mockFlushActiveWysiwygNow).toHaveBeenCalledTimes(1);

    openAllRegisteredPopups();
    cleanupBeforeModeSwitch();
    expect(mockFlushActiveWysiwygNow).toHaveBeenCalledTimes(2);
  });

  it("always calls hideImagePreview inside the try block", () => {
    cleanupBeforeModeSwitch();
    expect(mockHideImagePreview).toHaveBeenCalledTimes(1);
  });

  it("swallows exceptions from hideImagePreview so mode switch is not blocked", () => {
    mockHideImagePreview.mockImplementationOnce(() => {
      throw new Error("preview teardown failed");
    });

    expect(() => cleanupBeforeModeSwitch()).not.toThrow();
    // Pre-try work must still have run.
    expect(mockFlushActiveWysiwygNow).toHaveBeenCalledTimes(1);
  });
});
