/**
 * Tests for media path detection utility.
 */

import { describe, it, expect } from "vitest";
import {
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  hasVideoExtension,
  hasAudioExtension,
  getMediaType,
} from "./mediaPathDetection";

describe("mediaPathDetection", () => {
  describe("VIDEO_EXTENSIONS", () => {
    it("includes common video formats", () => {
      expect(VIDEO_EXTENSIONS).toContain(".mp4");
      expect(VIDEO_EXTENSIONS).toContain(".webm");
      expect(VIDEO_EXTENSIONS).toContain(".mov");
      expect(VIDEO_EXTENSIONS).toContain(".ogv");
    });
  });

  describe("AUDIO_EXTENSIONS", () => {
    it("includes common audio formats", () => {
      expect(AUDIO_EXTENSIONS).toContain(".mp3");
      expect(AUDIO_EXTENSIONS).toContain(".ogg");
      expect(AUDIO_EXTENSIONS).toContain(".wav");
      expect(AUDIO_EXTENSIONS).toContain(".flac");
      expect(AUDIO_EXTENSIONS).toContain(".m4a");
    });
  });

  describe("hasVideoExtension", () => {
    it.each([
      "video.mp4",
      "video.webm",
      "video.mov",
      "video.avi",
      "video.mkv",
      "video.m4v",
      "video.ogv",
    ])("returns true for %s", (path) => {
      expect(hasVideoExtension(path)).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(hasVideoExtension("video.MP4")).toBe(true);
      expect(hasVideoExtension("video.WebM")).toBe(true);
    });

    it("returns false for non-video files", () => {
      expect(hasVideoExtension("image.png")).toBe(false);
      expect(hasVideoExtension("audio.mp3")).toBe(false);
      expect(hasVideoExtension("doc.txt")).toBe(false);
    });

    it("handles paths with directories", () => {
      expect(hasVideoExtension("./assets/video.mp4")).toBe(true);
      expect(hasVideoExtension("/path/to/video.webm")).toBe(true);
    });

    it("handles URLs with query params", () => {
      expect(hasVideoExtension("https://example.com/video.mp4?t=10")).toBe(true);
    });

    it("handles empty and invalid inputs", () => {
      expect(hasVideoExtension("")).toBe(false);
      expect(hasVideoExtension("noext")).toBe(false);
    });
  });

  describe("hasAudioExtension", () => {
    it.each([
      "audio.mp3",
      "audio.m4a",
      "audio.ogg",
      "audio.wav",
      "audio.flac",
      "audio.aac",
      "audio.opus",
    ])("returns true for %s", (path) => {
      expect(hasAudioExtension(path)).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(hasAudioExtension("audio.MP3")).toBe(true);
      expect(hasAudioExtension("audio.FLAC")).toBe(true);
    });

    it("returns false for non-audio files", () => {
      expect(hasAudioExtension("video.mp4")).toBe(false);
      expect(hasAudioExtension("image.jpg")).toBe(false);
    });

    it("handles paths with directories", () => {
      expect(hasAudioExtension("./assets/song.mp3")).toBe(true);
    });

    it("handles URLs with query params", () => {
      expect(hasAudioExtension("https://example.com/song.mp3?dl=1")).toBe(true);
    });

    it("handles empty and invalid inputs", () => {
      expect(hasAudioExtension("")).toBe(false);
      expect(hasAudioExtension("noext")).toBe(false);
    });
  });

  describe("getMediaType", () => {
    it("returns 'video' for video extensions", () => {
      expect(getMediaType("clip.mp4")).toBe("video");
      expect(getMediaType("clip.webm")).toBe("video");
    });

    it("returns 'audio' for audio extensions", () => {
      expect(getMediaType("song.mp3")).toBe("audio");
      expect(getMediaType("track.flac")).toBe("audio");
    });

    it("returns 'image' for image extensions", () => {
      expect(getMediaType("photo.png")).toBe("image");
      expect(getMediaType("photo.jpg")).toBe("image");
      expect(getMediaType("photo.gif")).toBe("image");
      expect(getMediaType("photo.webp")).toBe("image");
      expect(getMediaType("photo.svg")).toBe("image");
    });

    it("returns null for unknown extensions", () => {
      expect(getMediaType("doc.txt")).toBeNull();
      expect(getMediaType("data.json")).toBeNull();
      expect(getMediaType("")).toBeNull();
    });

    it("is case-insensitive", () => {
      expect(getMediaType("VIDEO.MP4")).toBe("video");
      expect(getMediaType("AUDIO.MP3")).toBe("audio");
      expect(getMediaType("IMAGE.PNG")).toBe("image");
    });

    it("handles URLs with query params", () => {
      expect(getMediaType("https://cdn.example.com/file.mp4?token=abc")).toBe("video");
    });
  });
});
