/**
 * Tests for media (video/audio) markdown pipeline converters.
 *
 * Tests HTML -> block_video/block_audio node promotion, image-syntax auto-promotion
 * based on file extension, and PM -> MDAST serialization round-trips.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Html, Paragraph, Image } from "mdast";
import { convertHtml, convertParagraph, type MdastToPmContext } from "../mdastBlockConverters";
import { convertBlockVideo, convertBlockAudio } from "../pmBlockConverters";

/** Minimal schema with paragraph, block_image, block_video, block_audio, html_block */
function createMediaSchema() {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline", inline: true },
      image: {
        inline: true,
        group: "inline",
        attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" } },
      },
      block_image: {
        group: "block",
        atom: true,
        attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" }, sourceLine: { default: null } },
      },
      block_video: {
        group: "block",
        atom: true,
        attrs: {
          src: { default: "" },
          title: { default: "" },
          poster: { default: "" },
          controls: { default: true },
          preload: { default: "metadata" },
          sourceLine: { default: null },
        },
      },
      block_audio: {
        group: "block",
        atom: true,
        attrs: {
          src: { default: "" },
          title: { default: "" },
          controls: { default: true },
          preload: { default: "metadata" },
          sourceLine: { default: null },
        },
      },
      html_block: {
        group: "block",
        atom: true,
        attrs: { value: { default: "" }, sourceLine: { default: null } },
      },
    },
  });
}

function createContext(schema: Schema): MdastToPmContext {
  return {
    schema,
    convertChildren: () => [],
  };
}

describe("media pipeline converters", () => {
  const schema = createMediaSchema();
  const context = createContext(schema);

  describe("convertHtml — video promotion", () => {
    it("promotes <video> HTML to block_video node", () => {
      const htmlNode: Html = {
        type: "html",
        value: '<video src="clip.mp4" controls></video>',
        position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 40, offset: 39 } },
      };
      const result = convertHtml(context, htmlNode, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.src).toBe("clip.mp4");
      expect(result!.attrs.controls).toBe(true);
    });

    it("promotes <video> with poster and title", () => {
      const htmlNode: Html = {
        type: "html",
        value: '<video src="clip.mp4" poster="thumb.jpg" title="My Video" controls></video>',
      };
      const result = convertHtml(context, htmlNode, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.poster).toBe("thumb.jpg");
      expect(result!.attrs.title).toBe("My Video");
    });

    it("promotes <audio> HTML to block_audio node", () => {
      const htmlNode: Html = {
        type: "html",
        value: '<audio src="song.mp3" controls></audio>',
      };
      const result = convertHtml(context, htmlNode, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
      expect(result!.attrs.src).toBe("song.mp3");
      expect(result!.attrs.controls).toBe(true);
    });

    it("does not promote non-media HTML", () => {
      const htmlNode: Html = {
        type: "html",
        value: "<div>Hello</div>",
      };
      const result = convertHtml(context, htmlNode, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_block");
    });

    it("does not promote inline HTML context", () => {
      const htmlNode: Html = {
        type: "html",
        value: '<video src="clip.mp4" controls></video>',
      };
      // Inline context should not promote (videos are always block)
      const schemaWithInlineHtml = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { content: "inline*", group: "block" },
          text: { group: "inline", inline: true },
          html_inline: {
            inline: true,
            group: "inline",
            atom: true,
            attrs: { value: { default: "" }, sourceLine: { default: null } },
          },
          html_block: {
            group: "block",
            atom: true,
            attrs: { value: { default: "" }, sourceLine: { default: null } },
          },
          block_video: {
            group: "block",
            atom: true,
            attrs: {
              src: { default: "" },
              title: { default: "" },
              poster: { default: "" },
              controls: { default: true },
              preload: { default: "metadata" },
              sourceLine: { default: null },
            },
          },
        },
      });
      const inlineContext = createContext(schemaWithInlineHtml);
      const result = convertHtml(inlineContext, htmlNode, true);
      // In inline context, it should still be html_inline, not promoted
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("html_inline");
    });

    it("handles <video> without controls attribute", () => {
      const htmlNode: Html = {
        type: "html",
        value: '<video src="clip.mp4"></video>',
      };
      const result = convertHtml(context, htmlNode, false);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.controls).toBe(false);
    });

    it("handles <video> with preload attribute", () => {
      const htmlNode: Html = {
        type: "html",
        value: '<video src="clip.mp4" preload="auto" controls></video>',
      };
      const result = convertHtml(context, htmlNode, false);
      expect(result!.attrs.preload).toBe("auto");
    });
  });

  describe("convertParagraph — extension-based promotion", () => {
    it("promotes image-syntax video to block_video", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          {
            type: "image",
            url: "./assets/clip.mp4",
            alt: "A video clip",
            title: "My Video",
          } as Image,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.src).toBe("./assets/clip.mp4");
      expect(result!.attrs.title).toBe("My Video");
    });

    it("promotes image-syntax audio to block_audio", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          {
            type: "image",
            url: "./assets/song.mp3",
            alt: "A song",
            title: "My Song",
          } as Image,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
      expect(result!.attrs.src).toBe("./assets/song.mp3");
    });

    it("still promotes image extensions to block_image", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          {
            type: "image",
            url: "./assets/photo.png",
            alt: "A photo",
            title: "",
          } as Image,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_image");
    });

    it("handles case-insensitive extensions", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          {
            type: "image",
            url: "./assets/clip.MP4",
            alt: "",
            title: "",
          } as Image,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result!.type.name).toBe("block_video");
    });

    it("handles URLs with query params", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          {
            type: "image",
            url: "https://example.com/video.webm?token=abc",
            alt: "",
            title: "",
          } as Image,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result!.type.name).toBe("block_video");
    });
  });

  describe("PM → MDAST: convertBlockVideo", () => {
    it("serializes to <video> HTML block", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        title: "My Video",
        controls: true,
      });
      const result = convertBlockVideo(node);
      expect(result.type).toBe("html");
      expect(result.value).toContain("<video");
      expect(result.value).toContain('src="clip.mp4"');
      expect(result.value).toContain("controls");
      expect(result.value).toContain('title="My Video"');
      expect(result.value).toContain("</video>");
    });

    it("includes poster when present", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        poster: "thumb.jpg",
        controls: true,
      });
      const result = convertBlockVideo(node);
      expect(result.value).toContain('poster="thumb.jpg"');
    });

    it("omits controls when false", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        controls: false,
      });
      const result = convertBlockVideo(node);
      expect(result.value).not.toContain("controls");
    });
  });

  describe("PM → MDAST: convertBlockAudio", () => {
    it("serializes to <audio> HTML block", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        title: "My Song",
        controls: true,
      });
      const result = convertBlockAudio(node);
      expect(result.type).toBe("html");
      expect(result.value).toContain("<audio");
      expect(result.value).toContain('src="song.mp3"');
      expect(result.value).toContain("controls");
      expect(result.value).toContain('title="My Song"');
      expect(result.value).toContain("</audio>");
    });

    it("omits controls when false", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        controls: false,
      });
      const result = convertBlockAudio(node);
      expect(result.value).not.toContain("controls");
    });
  });
});
