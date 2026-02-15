/**
 * Tests for media (video/audio) markdown pipeline converters.
 *
 * Tests HTML -> block_video/block_audio node promotion, image-syntax auto-promotion
 * based on file extension, PM -> MDAST serialization (image-syntax-first with HTML
 * fallback), and round-trip integrity through serialize-then-reparse cycles.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Html, Paragraph, Image, Root } from "mdast";
import { convertHtml, convertParagraph, type MdastToPmContext } from "../mdastBlockConverters";
import { convertBlockVideo, convertBlockAudio } from "../pmBlockConverters";
import { serializeMdastToMarkdown } from "../serializer";
import { parseMarkdownToMdast } from "../parser";

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

  describe("convertParagraph — inline HTML media promotion (safety net)", () => {
    it("promotes single <video> html child to block_video", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          { type: "html", value: '<video src="clip.mp4" controls></video>' } as Html,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_video");
      expect(result!.attrs.src).toBe("clip.mp4");
    });

    it("promotes single <audio> html child to block_audio", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          { type: "html", value: '<audio src="song.mp3" controls></audio>' } as Html,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("block_audio");
      expect(result!.attrs.src).toBe("song.mp3");
    });

    it("does not promote single <div> html child", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          { type: "html", value: "<div>Hello</div>" } as Html,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("paragraph");
    });

    it("does not promote html child mixed with text", () => {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [
          { type: "text", value: "Watch: " },
          { type: "html", value: '<video src="clip.mp4" controls></video>' } as Html,
        ],
      };
      const result = convertParagraph(context, paragraph, []);
      expect(result).not.toBeNull();
      expect(result!.type.name).toBe("paragraph");
    });
  });

  describe("PM → MDAST: convertBlockVideo (image-syntax-first)", () => {
    it("serializes default attrs to Paragraph { Image } with .mp4 URL", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        controls: true,
      });
      const result = convertBlockVideo(node);
      expect(result.type).toBe("paragraph");
      const para = result as Paragraph;
      expect(para.children).toHaveLength(1);
      expect(para.children[0].type).toBe("image");
      const img = para.children[0] as Image;
      expect(img.url).toBe("clip.mp4");
    });

    it("includes title in Image node", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        title: "My Video",
        controls: true,
      });
      const result = convertBlockVideo(node);
      expect(result.type).toBe("paragraph");
      const img = (result as Paragraph).children[0] as Image;
      expect(img.title).toBe("My Video");
    });

    it("falls back to multi-line HTML when poster is set", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        poster: "thumb.jpg",
        controls: true,
      });
      const result = convertBlockVideo(node);
      expect(result.type).toBe("html");
      const html = result as Html;
      expect(html.value).toContain('poster="thumb.jpg"');
      expect(html.value).toContain("\n");
    });

    it("falls back to multi-line HTML when controls is false", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        controls: false,
      });
      const result = convertBlockVideo(node);
      expect(result.type).toBe("html");
      const html = result as Html;
      expect(html.value).not.toContain("controls");
      expect(html.value).toContain("\n");
    });

    it("falls back to multi-line HTML when preload is not metadata", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        controls: true,
        preload: "auto",
      });
      const result = convertBlockVideo(node);
      expect(result.type).toBe("html");
      const html = result as Html;
      expect(html.value).toContain('preload="auto"');
      expect(html.value).toContain("\n");
    });
  });

  describe("PM → MDAST: convertBlockAudio (image-syntax-first)", () => {
    it("serializes default attrs to Paragraph { Image } with .mp3 URL", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        controls: true,
      });
      const result = convertBlockAudio(node);
      expect(result.type).toBe("paragraph");
      const para = result as Paragraph;
      expect(para.children).toHaveLength(1);
      expect(para.children[0].type).toBe("image");
      const img = para.children[0] as Image;
      expect(img.url).toBe("song.mp3");
    });

    it("includes title in Image node", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        title: "My Song",
        controls: true,
      });
      const result = convertBlockAudio(node);
      expect(result.type).toBe("paragraph");
      const img = (result as Paragraph).children[0] as Image;
      expect(img.title).toBe("My Song");
    });

    it("falls back to multi-line HTML when controls is false", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        controls: false,
      });
      const result = convertBlockAudio(node);
      expect(result.type).toBe("html");
      const html = result as Html;
      expect(html.value).not.toContain("controls");
      expect(html.value).toContain("\n");
    });

    it("falls back to multi-line HTML when preload is not metadata", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        controls: true,
        preload: "auto",
      });
      const result = convertBlockAudio(node);
      expect(result.type).toBe("html");
      const html = result as Html;
      expect(html.value).toContain('preload="auto"');
      expect(html.value).toContain("\n");
    });
  });

  describe("round-trip: serialize → reparse", () => {
    it("convertBlockVideo output re-parsed by convertParagraph → block_video", () => {
      const node = schema.nodes.block_video.create({
        src: "demo.mp4",
        title: "Demo",
        controls: true,
      });
      // Serialize: PM → MDAST
      const mdast = convertBlockVideo(node);
      expect(mdast.type).toBe("paragraph");

      // Reparse: MDAST → PM (the paragraph contains a single image with .mp4 extension)
      const reparsed = convertParagraph(context, mdast as Paragraph, []);
      expect(reparsed).not.toBeNull();
      expect(reparsed!.type.name).toBe("block_video");
      expect(reparsed!.attrs.src).toBe("demo.mp4");
      expect(reparsed!.attrs.title).toBe("Demo");
    });

    it("convertBlockAudio output re-parsed by convertParagraph → block_audio", () => {
      const node = schema.nodes.block_audio.create({
        src: "podcast.mp3",
        title: "Episode 1",
        controls: true,
      });
      const mdast = convertBlockAudio(node);
      expect(mdast.type).toBe("paragraph");

      const reparsed = convertParagraph(context, mdast as Paragraph, []);
      expect(reparsed).not.toBeNull();
      expect(reparsed!.type.name).toBe("block_audio");
      expect(reparsed!.attrs.src).toBe("podcast.mp3");
      expect(reparsed!.attrs.title).toBe("Episode 1");
    });

    it("convertBlockVideo with poster round-trips via HTML fallback", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        poster: "thumb.jpg",
        controls: true,
      });
      const mdast = convertBlockVideo(node);
      expect(mdast.type).toBe("html");

      // Multi-line HTML is parsed as block HTML → convertHtml promotes it
      const reparsed = convertHtml(context, mdast as Html, false);
      expect(reparsed).not.toBeNull();
      expect(reparsed!.type.name).toBe("block_video");
      expect(reparsed!.attrs.poster).toBe("thumb.jpg");
    });
  });

  describe("end-to-end: stringify → markdown → reparse MDAST", () => {
    it("image-syntax video survives full markdown round-trip", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        title: "Demo",
        controls: true,
      });
      const mdast = convertBlockVideo(node);
      expect(mdast.type).toBe("paragraph");

      // Stringify MDAST → markdown string
      const root: Root = { type: "root", children: [mdast as Paragraph] };
      const md = serializeMdastToMarkdown(root);
      expect(md).toContain("clip.mp4");

      // Reparse markdown string → MDAST
      const reparsedRoot = parseMarkdownToMdast(md);
      const para = reparsedRoot.children[0];
      expect(para?.type).toBe("paragraph");
      const imgChild = (para as Paragraph).children[0];
      expect(imgChild?.type).toBe("image");
      expect((imgChild as Image).url).toBe("clip.mp4");
    });

    it("HTML-fallback video survives full markdown round-trip", () => {
      const node = schema.nodes.block_video.create({
        src: "clip.mp4",
        poster: "thumb.jpg",
        controls: true,
      });
      const mdast = convertBlockVideo(node);
      expect(mdast.type).toBe("html");

      const root: Root = { type: "root", children: [mdast as Html] };
      const md = serializeMdastToMarkdown(root);
      expect(md).toContain("<video");
      expect(md).toContain("poster");

      // Reparse: multi-line HTML should parse as block html
      const reparsedRoot = parseMarkdownToMdast(md);
      const htmlBlock = reparsedRoot.children[0];
      expect(htmlBlock?.type).toBe("html");
      expect((htmlBlock as Html).value).toContain("poster");
    });

    it("image-syntax audio survives full markdown round-trip", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        title: "Podcast",
        controls: true,
      });
      const mdast = convertBlockAudio(node);
      expect(mdast.type).toBe("paragraph");

      const root: Root = { type: "root", children: [mdast as Paragraph] };
      const md = serializeMdastToMarkdown(root);
      expect(md).toContain("song.mp3");

      const reparsedRoot = parseMarkdownToMdast(md);
      const para = reparsedRoot.children[0];
      expect(para?.type).toBe("paragraph");
      const imgChild = (para as Paragraph).children[0];
      expect(imgChild?.type).toBe("image");
      expect((imgChild as Image).url).toBe("song.mp3");
    });
  });
});
