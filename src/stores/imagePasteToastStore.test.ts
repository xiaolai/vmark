import { describe, it, expect, beforeEach, vi } from "vitest";
import { useImagePasteToastStore } from "./imagePasteToastStore";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { AnchorRect } from "@/utils/popupPosition";

describe("imagePasteToastStore", () => {
  const mockAnchorRect: AnchorRect = { x: 100, y: 200, width: 50, height: 20 };
  const mockEditorDom = document.createElement("div");

  beforeEach(() => {
    useImagePasteToastStore.setState({
      isOpen: false,
      imagePath: "",
      imageType: "url",
      imagePaths: [],
      imageResults: [],
      isMultiple: false,
      imageCount: 0,
      anchorRect: null,
      editorDom: null,
      onConfirm: null,
      onDismiss: null,
    });
  });

  // ── Default state ──────────────────────────────────────────────────

  it("initializes with default state", () => {
    const state = useImagePasteToastStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.imagePath).toBe("");
    expect(state.imageType).toBe("url");
    expect(state.imagePaths).toEqual([]);
    expect(state.imageResults).toEqual([]);
    expect(state.isMultiple).toBe(false);
    expect(state.imageCount).toBe(0);
    expect(state.anchorRect).toBeNull();
    expect(state.editorDom).toBeNull();
    expect(state.onConfirm).toBeNull();
    expect(state.onDismiss).toBeNull();
  });

  // ── showToast (single image) ──────────────────────────────────────

  describe("showToast", () => {
    it("opens toast with single image URL", () => {
      const onConfirm = vi.fn();
      const onDismiss = vi.fn();

      useImagePasteToastStore.getState().showToast({
        imagePath: "https://example.com/img.png",
        imageType: "url",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm,
        onDismiss,
      });

      const state = useImagePasteToastStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.imagePath).toBe("https://example.com/img.png");
      expect(state.imageType).toBe("url");
      expect(state.isMultiple).toBe(false);
      expect(state.imageCount).toBe(1);
      expect(state.anchorRect).toEqual(mockAnchorRect);
      expect(state.editorDom).toBe(mockEditorDom);
      expect(state.onConfirm).toBe(onConfirm);
      expect(state.onDismiss).toBe(onDismiss);
    });

    it("opens toast with local path", () => {
      useImagePasteToastStore.getState().showToast({
        imagePath: "/Users/test/photo.jpg",
        imageType: "localPath",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm: vi.fn(),
        onDismiss: vi.fn(),
      });

      const state = useImagePasteToastStore.getState();
      expect(state.imageType).toBe("localPath");
      expect(state.imagePath).toBe("/Users/test/photo.jpg");
    });

    it("clears multi-image fields when showing single toast", () => {
      // Pre-populate multi fields
      useImagePasteToastStore.setState({
        imagePaths: ["a.png", "b.png"],
        imageResults: [
          { path: "a.png", type: "localPath" } as ImagePathResult,
        ],
        isMultiple: true,
        imageCount: 2,
      });

      useImagePasteToastStore.getState().showToast({
        imagePath: "single.png",
        imageType: "url",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm: vi.fn(),
        onDismiss: vi.fn(),
      });

      const state = useImagePasteToastStore.getState();
      expect(state.imagePaths).toEqual([]);
      expect(state.imageResults).toEqual([]);
      expect(state.isMultiple).toBe(false);
      expect(state.imageCount).toBe(1);
    });
  });

  // ── showMultiToast ────────────────────────────────────────────────

  describe("showMultiToast", () => {
    it("opens toast with multiple image results", () => {
      const results: ImagePathResult[] = [
        { path: "/img/a.png", type: "localPath" } as ImagePathResult,
        { path: "https://x.com/b.jpg", type: "url" } as ImagePathResult,
        { path: "/img/c.gif", type: "localPath" } as ImagePathResult,
      ];
      const onConfirm = vi.fn();
      const onDismiss = vi.fn();

      useImagePasteToastStore.getState().showMultiToast({
        imageResults: results,
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm,
        onDismiss,
      });

      const state = useImagePasteToastStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.isMultiple).toBe(true);
      expect(state.imageCount).toBe(3);
      expect(state.imagePaths).toEqual([
        "/img/a.png",
        "https://x.com/b.jpg",
        "/img/c.gif",
      ]);
      expect(state.imageResults).toBe(results);
      expect(state.imagePath).toBe("");
      expect(state.imageType).toBe("localPath");
      expect(state.onConfirm).toBe(onConfirm);
      expect(state.onDismiss).toBe(onDismiss);
    });

    it("handles empty image results array", () => {
      useImagePasteToastStore.getState().showMultiToast({
        imageResults: [],
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm: vi.fn(),
        onDismiss: vi.fn(),
      });

      const state = useImagePasteToastStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.isMultiple).toBe(true);
      expect(state.imageCount).toBe(0);
      expect(state.imagePaths).toEqual([]);
    });

    it("handles single item in multi-toast", () => {
      const results: ImagePathResult[] = [
        { path: "only.png", type: "localPath" } as ImagePathResult,
      ];

      useImagePasteToastStore.getState().showMultiToast({
        imageResults: results,
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm: vi.fn(),
        onDismiss: vi.fn(),
      });

      const state = useImagePasteToastStore.getState();
      expect(state.isMultiple).toBe(true);
      expect(state.imageCount).toBe(1);
      expect(state.imagePaths).toEqual(["only.png"]);
    });
  });

  // ── hideToast ─────────────────────────────────────────────────────

  describe("hideToast", () => {
    it("resets all state to initial values", () => {
      useImagePasteToastStore.getState().showToast({
        imagePath: "test.png",
        imageType: "url",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm: vi.fn(),
        onDismiss: vi.fn(),
      });

      useImagePasteToastStore.getState().hideToast();

      const state = useImagePasteToastStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.imagePath).toBe("");
      expect(state.anchorRect).toBeNull();
      expect(state.onConfirm).toBeNull();
      expect(state.onDismiss).toBeNull();
    });

    it("is idempotent when already hidden", () => {
      useImagePasteToastStore.getState().hideToast();
      const state = useImagePasteToastStore.getState();
      expect(state.isOpen).toBe(false);
    });
  });

  // ── confirm ───────────────────────────────────────────────────────

  describe("confirm", () => {
    it("calls onConfirm callback and resets state", () => {
      const onConfirm = vi.fn();
      useImagePasteToastStore.getState().showToast({
        imagePath: "test.png",
        imageType: "url",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm,
        onDismiss: vi.fn(),
      });

      useImagePasteToastStore.getState().confirm();

      expect(onConfirm).toHaveBeenCalledOnce();
      expect(useImagePasteToastStore.getState().isOpen).toBe(false);
    });

    it("resets state even when onConfirm is null", () => {
      useImagePasteToastStore.setState({ isOpen: true, onConfirm: null });
      useImagePasteToastStore.getState().confirm();
      expect(useImagePasteToastStore.getState().isOpen).toBe(false);
    });

    it("resets state before invoking onConfirm so the callback can open a new toast", () => {
      const onConfirm = vi.fn(() => {
        // At invoke time the previous toast must already be reset...
        expect(useImagePasteToastStore.getState().isOpen).toBe(false);
        // ...so a toast opened by the callback survives the confirm.
        useImagePasteToastStore.getState().showToast({
          imagePath: "second.png",
          imageType: "url",
          anchorRect: mockAnchorRect,
          editorDom: mockEditorDom,
          onConfirm: vi.fn(),
          onDismiss: vi.fn(),
        });
      });

      useImagePasteToastStore.getState().showToast({
        imagePath: "first.png",
        imageType: "url",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm,
        onDismiss: vi.fn(),
      });

      useImagePasteToastStore.getState().confirm();

      expect(onConfirm).toHaveBeenCalledOnce();
      const state = useImagePasteToastStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.imagePath).toBe("second.png");
    });
  });

  // ── dismiss ───────────────────────────────────────────────────────

  describe("dismiss", () => {
    it("calls onDismiss callback and resets state", () => {
      const onDismiss = vi.fn();
      useImagePasteToastStore.getState().showToast({
        imagePath: "test.png",
        imageType: "url",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm: vi.fn(),
        onDismiss,
      });

      useImagePasteToastStore.getState().dismiss();

      expect(onDismiss).toHaveBeenCalledOnce();
      expect(useImagePasteToastStore.getState().isOpen).toBe(false);
    });

    it("resets state even when onDismiss is null", () => {
      useImagePasteToastStore.setState({ isOpen: true, onDismiss: null });
      useImagePasteToastStore.getState().dismiss();
      expect(useImagePasteToastStore.getState().isOpen).toBe(false);
    });

    it("resets state before invoking onDismiss so the callback can open a new toast", () => {
      const onDismiss = vi.fn(() => {
        expect(useImagePasteToastStore.getState().isOpen).toBe(false);
        useImagePasteToastStore.getState().showToast({
          imagePath: "second.png",
          imageType: "url",
          anchorRect: mockAnchorRect,
          editorDom: mockEditorDom,
          onConfirm: vi.fn(),
          onDismiss: vi.fn(),
        });
      });

      useImagePasteToastStore.getState().showToast({
        imagePath: "first.png",
        imageType: "url",
        anchorRect: mockAnchorRect,
        editorDom: mockEditorDom,
        onConfirm: vi.fn(),
        onDismiss,
      });

      useImagePasteToastStore.getState().dismiss();

      expect(onDismiss).toHaveBeenCalledOnce();
      const state = useImagePasteToastStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.imagePath).toBe("second.png");
    });
  });

  // ── Overwrite behavior ────────────────────────────────────────────

  it("showToast overwrites a previous showMultiToast", () => {
    useImagePasteToastStore.getState().showMultiToast({
      imageResults: [
        { path: "a.png", type: "localPath" } as ImagePathResult,
      ],
      anchorRect: mockAnchorRect,
      editorDom: mockEditorDom,
      onConfirm: vi.fn(),
      onDismiss: vi.fn(),
    });

    useImagePasteToastStore.getState().showToast({
      imagePath: "single.png",
      imageType: "url",
      anchorRect: mockAnchorRect,
      editorDom: mockEditorDom,
      onConfirm: vi.fn(),
      onDismiss: vi.fn(),
    });

    const state = useImagePasteToastStore.getState();
    expect(state.isMultiple).toBe(false);
    expect(state.imagePath).toBe("single.png");
    expect(state.imagePaths).toEqual([]);
  });
});
