// @vitest-environment node
/**
 * PM → MDAST media serialization (pmMediaConverters) — the round-trip gate
 * (image syntax only for recognizable media extensions) and the data-alt
 * HTML-fallback metadata channel. Split from pmBlockConverters.test.ts
 * (size-baselined).
 */
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Html } from "mdast";
import { convertBlockVideo, convertBlockAudio } from "./pmMediaConverters";

const mediaSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    block_video: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: "" },
        alt: { default: "" },
        title: { default: "" },
        poster: { default: "" },
        controls: { default: true },
        preload: { default: "metadata" },
      },
    },
    block_audio: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: "" },
        alt: { default: "" },
        title: { default: "" },
        controls: { default: true },
        preload: { default: "metadata" },
      },
    },
  },
});

describe("media round-trip gate", () => {
    it("uses image syntax only when the extension survives the round trip", () => {
      const withExt = mediaSchema.nodes.block_video.create({ src: "clip.mp4" });
      expect(convertBlockVideo(withExt).type).toBe("paragraph");
      // Extensionless / signed URLs must NOT become image syntax.
      const signed = mediaSchema.nodes.block_video.create({ src: "https://cdn.example.com/v/12345?sig=abc" });
      expect(convertBlockVideo(signed).type).toBe("html");
    });

    it("preserves alt through the HTML fallback as data-alt", () => {
      const node = mediaSchema.nodes.block_video.create({
        src: "clip.mp4",
        alt: "A demo clip",
        poster: "thumb.jpg",
      });
      const result = convertBlockVideo(node);
      expect(result.type).toBe("html");
      expect((result as Html).value).toContain('data-alt="A demo clip"');
    });

    it("uses image syntax for a recognizable audio extension", () => {
      const node = mediaSchema.nodes.block_audio.create({ src: "song.mp3" });
      expect(convertBlockAudio(node).type).toBe("paragraph");
    });
});
