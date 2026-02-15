/**
 * Tests for media popup store — open/close, state updates, type-specific fields.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useMediaPopupStore } from "./mediaPopupStore";

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

  it("sets src", () => {
    useMediaPopupStore.getState().setSrc("new-video.mp4");
    expect(useMediaPopupStore.getState().mediaSrc).toBe("new-video.mp4");
  });

  it("sets title", () => {
    useMediaPopupStore.getState().setTitle("New Title");
    expect(useMediaPopupStore.getState().mediaTitle).toBe("New Title");
  });

  it("sets poster", () => {
    useMediaPopupStore.getState().setPoster("new-poster.jpg");
    expect(useMediaPopupStore.getState().mediaPoster).toBe("new-poster.jpg");
  });
});
