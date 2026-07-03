import { describe, it, expect, beforeEach } from "vitest";
import { registerMediaFormat, mediaFormat, MEDIA_EXTENSIONS } from "./media";
import {
  dispatchEditor,
  getFormatById,
  __resetRegistry,
} from "../registry";
import { registerTxtFormat } from "./txt";

describe("media format adapter", () => {
  beforeEach(() => {
    __resetRegistry();
    // txt is the plain-text fallback dispatchEditor needs for unknown paths.
    registerTxtFormat();
  });

  it("registers as a media-kind, read-only, non-editable format", () => {
    registerMediaFormat();
    const cfg = getFormatById("media");
    expect(cfg).toBeDefined();
    expect(cfg?.kind).toBe("media");
    expect(cfg?.adapters.readOnlyDefault).toBe(true);
    expect(cfg?.adapters.closeSavePolicy).toBe("save-as-only");
    expect(cfg?.adapters.contentSearchIndexed).toBe(false);
    expect(cfg?.adapters.exportEnabled).toBe(false);
    // No source pane / preview slot — the surface is mounted by Editor.tsx.
    expect(cfg?.genericPreview).toBeUndefined();
    expect(cfg?.wysiwygComponent).toBeUndefined();
  });

  it("does not claim the svg extension (svg owns its own format)", () => {
    expect(MEDIA_EXTENSIONS).not.toContain("svg");
    expect(mediaFormat.extensions).not.toContain("svg");
  });

  it("covers image, video, and audio extensions", () => {
    expect(MEDIA_EXTENSIONS).toEqual(expect.arrayContaining(["png", "jpg", "webp", "heic"]));
    expect(MEDIA_EXTENSIONS).toEqual(expect.arrayContaining(["mp4", "webm", "mov"]));
    expect(MEDIA_EXTENSIONS).toEqual(expect.arrayContaining(["mp3", "wav", "flac"]));
  });

  it("dispatches media file paths to the media format", () => {
    registerMediaFormat();
    expect(dispatchEditor("/x/photo.png").id).toBe("media");
    expect(dispatchEditor("/x/clip.MP4").id).toBe("media"); // case-insensitive
    expect(dispatchEditor("/x/song.mp3").id).toBe("media");
    // Non-media still falls back to plain text, never media.
    expect(dispatchEditor("/x/notes.txt").id).toBe("txt");
  });

  it("registers without throwing despite readOnlyDefault + save-as-only", () => {
    // The registry carve-out for kind:"media" must permit this pairing that
    // is rejected for every other kind.
    expect(() => registerMediaFormat()).not.toThrow();
  });
});
