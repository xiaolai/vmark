// WI-0.6 — unify divergent media-extension lists (D3)
import { describe, it, expect } from "vitest";
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS_DOTTED,
  fileExtension,
} from "./mediaExtensions";
import { hasImageExtension } from "./imagePathDetection";
import { isImageFile } from "./imageUtils";
import { getMediaType, hasVideoExtension } from "./mediaPathDetection";

describe("mediaExtensions canonical sets", () => {
  it("IMAGE is the agreed union, broadened for the media viewer", () => {
    expect([...IMAGE_EXTENSIONS]).toEqual([
      "png",
      "jpg",
      "jpeg",
      "jfif",
      "gif",
      "webp",
      "svg",
      "bmp",
      "ico",
      "avif",
      "apng",
      "heic",
      "heif",
      "tiff",
      "tif",
    ]);
  });

  it("VIDEO and AUDIO sets cover the media viewer's formats", () => {
    expect([...VIDEO_EXTENSIONS]).toEqual([
      "mp4",
      "webm",
      "mov",
      "avi",
      "mkv",
      "m4v",
      "ogv",
      "mpeg",
      "mpg",
      "wmv",
      "flv",
      "3gp",
    ]);
    expect([...AUDIO_EXTENSIONS]).toEqual([
      "mp3",
      "m4a",
      "ogg",
      "oga",
      "wav",
      "flac",
      "aac",
      "opus",
      "weba",
      "aiff",
      "wma",
    ]);
  });

  it("dotted form mirrors bare form", () => {
    expect(IMAGE_EXTENSIONS_DOTTED).toEqual(IMAGE_EXTENSIONS.map((e) => `.${e}`));
  });

  it("fileExtension normalizes paths/urls", () => {
    expect(fileExtension("photo.AVIF")).toBe("avif");
    expect(fileExtension("https://x.com/a/b.png?w=1#frag")).toBe("png");
    expect(fileExtension("/p/.gitignore")).toBe("");
    expect(fileExtension("noext")).toBe("");
  });
});

describe("all detection paths agree on the canonical set", () => {
  // .avif was present in some copies, absent in others — every path must now agree.
  it.each(["avif", "bmp", "ico", "png", "svg"])("%s is an image everywhere", (ext) => {
    expect(hasImageExtension(`pic.${ext}`)).toBe(true);
    expect(isImageFile(`pic.${ext}`)).toBe(true);
    expect(getMediaType(`pic.${ext}`)).toBe("image");
  });

  it("video detection unchanged", () => {
    expect(hasVideoExtension("clip.mp4")).toBe(true);
    expect(getMediaType("clip.mp4")).toBe("video");
  });
});
