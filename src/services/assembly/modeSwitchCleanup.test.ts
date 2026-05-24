/**
 * Tests for cleanupBeforeModeSwitch.
 *
 * Single source of truth for cleanup between source ↔ WYSIWYG mode switches,
 * called from keyboard shortcut and menu event paths alike. Regression here
 * corrupts both interaction paths, so the try/catch boundary and the
 * always-flush ordering both need explicit coverage.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockHideToast,
  mockClosePopup,
  mockHideImagePreview,
  mockFlushActiveWysiwygNow,
  toastState,
  popupState,
} = vi.hoisted(() => ({
  mockHideToast: vi.fn(),
  mockClosePopup: vi.fn(),
  mockHideImagePreview: vi.fn(),
  mockFlushActiveWysiwygNow: vi.fn(),
  toastState: { isOpen: false },
  popupState: { isOpen: false },
}));

vi.mock("@/stores/imagePasteToastStore", () => ({
  useImagePasteToastStore: {
    getState: () => ({
      isOpen: toastState.isOpen,
      hideToast: mockHideToast,
    }),
  },
}));

vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: () => ({
      isOpen: popupState.isOpen,
      closePopup: mockClosePopup,
    }),
  },
}));

vi.mock("@/plugins/imagePreview/ImagePreviewView", () => ({
  hideImagePreview: (...args: unknown[]) => mockHideImagePreview(...args),
}));

vi.mock("@/utils/wysiwygFlush", () => ({
  flushActiveWysiwygNow: (...args: unknown[]) => mockFlushActiveWysiwygNow(...args),
}));

import { cleanupBeforeModeSwitch } from "./modeSwitchCleanup";

beforeEach(() => {
  mockHideToast.mockReset();
  mockClosePopup.mockReset();
  mockHideImagePreview.mockReset();
  mockFlushActiveWysiwygNow.mockReset();
  toastState.isOpen = false;
  popupState.isOpen = false;
});

describe("cleanupBeforeModeSwitch", () => {
  it("closes the image-paste toast when it is open", () => {
    toastState.isOpen = true;
    cleanupBeforeModeSwitch();
    expect(mockHideToast).toHaveBeenCalledTimes(1);
  });

  it("does NOT call hideToast when the toast is closed", () => {
    toastState.isOpen = false;
    cleanupBeforeModeSwitch();
    expect(mockHideToast).not.toHaveBeenCalled();
  });

  it("always flushes WYSIWYG regardless of toast/popup state", () => {
    cleanupBeforeModeSwitch();
    expect(mockFlushActiveWysiwygNow).toHaveBeenCalledTimes(1);

    toastState.isOpen = true;
    popupState.isOpen = true;
    cleanupBeforeModeSwitch();
    expect(mockFlushActiveWysiwygNow).toHaveBeenCalledTimes(2);
  });

  it("closes the media popup when it is open", () => {
    popupState.isOpen = true;
    cleanupBeforeModeSwitch();
    expect(mockClosePopup).toHaveBeenCalledTimes(1);
  });

  it("does NOT call closePopup when the popup is closed", () => {
    popupState.isOpen = false;
    cleanupBeforeModeSwitch();
    expect(mockClosePopup).not.toHaveBeenCalled();
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
