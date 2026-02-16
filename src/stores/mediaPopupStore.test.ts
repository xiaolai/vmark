/**
 * Tests for media popup store — open/close, state updates, type-specific fields.
 * Covers all 4 media types: image, block_image, block_video, block_audio.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useMediaPopupStore } from "./mediaPopupStore";

const rect = { top: 0, left: 0, bottom: 10, right: 10 };

describe("mediaPopupStore", () => {
  beforeEach(() => {
    useMediaPopupStore.getState().closePopup();
  });

  it("starts closed", () => {
    const state = useMediaPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.mediaSrc).toBe("");
    expect(state.mediaNodePos).toBe(-1);
  });

  // --- Video/Audio tests ---

  it("opens popup with video data", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "clip.mp4",
      mediaTitle: "My Video",
      mediaNodePos: 10,
      mediaNodeType: "block_video",
      mediaPoster: "thumb.jpg",
      anchorRect: { top: 100, left: 200, bottom: 300, right: 400 },
    });

    const state = useMediaPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.mediaSrc).toBe("clip.mp4");
    expect(state.mediaTitle).toBe("My Video");
    expect(state.mediaNodePos).toBe(10);
    expect(state.mediaNodeType).toBe("block_video");
    expect(state.mediaPoster).toBe("thumb.jpg");
    expect(state.anchorRect).toEqual({ top: 100, left: 200, bottom: 300, right: 400 });
  });

  it("opens popup with audio data", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "song.mp3",
      mediaTitle: "My Song",
      mediaNodePos: 5,
      mediaNodeType: "block_audio",
      mediaPoster: "",
      anchorRect: { top: 50, left: 100, bottom: 90, right: 300 },
    });

    const state = useMediaPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.mediaNodeType).toBe("block_audio");
    expect(state.mediaPoster).toBe("");
  });

  // --- Image tests ---

  it("opens with image data", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "/path/to/image.png",
      mediaAlt: "Test image",
      mediaNodePos: 42,
      mediaNodeType: "image",
      anchorRect: rect,
    });

    const state = useMediaPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.mediaSrc).toBe("/path/to/image.png");
    expect(state.mediaAlt).toBe("Test image");
    expect(state.mediaNodePos).toBe(42);
    expect(state.mediaNodeType).toBe("image");
    expect(state.anchorRect).toEqual(rect);
  });

  it("opens with block_image type", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "/path/to/image.png",
      mediaAlt: "Block image",
      mediaNodePos: 100,
      mediaNodeType: "block_image",
      anchorRect: rect,
    });

    expect(useMediaPopupStore.getState().mediaNodeType).toBe("block_image");
  });

  it("opens with image dimensions", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "/test.png",
      mediaAlt: "",
      mediaNodePos: 0,
      mediaNodeType: "image",
      mediaDimensions: { width: 800, height: 600 },
      anchorRect: rect,
    });

    expect(useMediaPopupStore.getState().mediaDimensions).toEqual({ width: 800, height: 600 });
  });

  it("defaults optional fields when opening image popup", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "/test.png",
      mediaNodePos: 0,
      mediaNodeType: "image",
      anchorRect: rect,
    });

    const state = useMediaPopupStore.getState();
    expect(state.mediaAlt).toBe("");
    expect(state.mediaTitle).toBe("");
    expect(state.mediaDimensions).toBeNull();
    expect(state.mediaPoster).toBe("");
  });

  // --- Close tests ---

  it("closes popup and resets state", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "clip.mp4",
      mediaTitle: "My Video",
      mediaNodePos: 10,
      mediaNodeType: "block_video",
      mediaPoster: "thumb.jpg",
      anchorRect: { top: 100, left: 200, bottom: 300, right: 400 },
    });

    useMediaPopupStore.getState().closePopup();

    const state = useMediaPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.mediaSrc).toBe("");
    expect(state.mediaTitle).toBe("");
    expect(state.mediaNodePos).toBe(-1);
    expect(state.anchorRect).toBeNull();
  });

  it("closes image popup and resets all fields", () => {
    useMediaPopupStore.getState().openPopup({
      mediaSrc: "/test.png",
      mediaAlt: "Test",
      mediaNodePos: 50,
      mediaNodeType: "block_image",
      mediaDimensions: { width: 100, height: 100 },
      anchorRect: rect,
    });
    useMediaPopupStore.getState().closePopup();

    const state = useMediaPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.mediaSrc).toBe("");
    expect(state.mediaAlt).toBe("");
    expect(state.mediaNodePos).toBe(-1);
    expect(state.mediaNodeType).toBe("block_video");
    expect(state.mediaDimensions).toBeNull();
    expect(state.anchorRect).toBeNull();
  });

  // --- Setter tests ---

  it("sets src", () => {
    useMediaPopupStore.getState().setSrc("new-video.mp4");
    expect(useMediaPopupStore.getState().mediaSrc).toBe("new-video.mp4");
  });

  it("sets alt", () => {
    useMediaPopupStore.getState().setAlt("New alt");
    expect(useMediaPopupStore.getState().mediaAlt).toBe("New alt");
  });

  it("sets title", () => {
    useMediaPopupStore.getState().setTitle("New Title");
    expect(useMediaPopupStore.getState().mediaTitle).toBe("New Title");
  });

  it("sets node type", () => {
    useMediaPopupStore.getState().setNodeType("block_image");
    expect(useMediaPopupStore.getState().mediaNodeType).toBe("block_image");
  });

  it("sets dimensions", () => {
    useMediaPopupStore.getState().setDimensions({ width: 1920, height: 1080 });
    expect(useMediaPopupStore.getState().mediaDimensions).toEqual({ width: 1920, height: 1080 });
  });

  it("clears dimensions", () => {
    useMediaPopupStore.getState().setDimensions({ width: 100, height: 100 });
    useMediaPopupStore.getState().setDimensions(null);
    expect(useMediaPopupStore.getState().mediaDimensions).toBeNull();
  });

  it("sets poster", () => {
    useMediaPopupStore.getState().setPoster("new-poster.jpg");
    expect(useMediaPopupStore.getState().mediaPoster).toBe("new-poster.jpg");
  });
});
