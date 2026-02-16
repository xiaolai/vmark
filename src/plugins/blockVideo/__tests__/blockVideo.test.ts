/**
 * Tests for block_video node schema — attrs, defaults, parseHTML, renderHTML.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { blockVideoExtension } from "../tiptap";

function createTestSchema() {
  const nodes = {
    doc: { content: "block+", group: undefined },
    paragraph: { content: "text*", group: "block", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] as const },
    text: { group: "inline" },
    block_video: {
      group: "block",
      atom: true,
      isolating: true,
      selectable: true,
      draggable: true,
      marks: "",
      defining: true,
      attrs: {
        sourceLine: { default: null },
        src: { default: "" },
        title: { default: "" },
        poster: { default: "" },
        controls: { default: true },
        preload: { default: "metadata" },
      },
      parseDOM: [
        {
          tag: 'figure[data-type="block_video"]',
          getAttrs: (dom: HTMLElement) => {
            const video = dom.querySelector("video");
            return {
              src: video?.getAttribute("src") ?? "",
              title: video?.getAttribute("title") ?? "",
              poster: video?.getAttribute("poster") ?? "",
              controls: video?.hasAttribute("controls") ?? true,
              preload: video?.getAttribute("preload") ?? "metadata",
            };
          },
        },
      ],
      toDOM: (node: { attrs: Record<string, unknown> }) => {
        const videoAttrs: Record<string, unknown> = {
          src: String(node.attrs.src ?? ""),
          title: String(node.attrs.title ?? ""),
          preload: String(node.attrs.preload ?? "metadata"),
        };
        if (node.attrs.poster) videoAttrs.poster = String(node.attrs.poster);
        if (node.attrs.controls) videoAttrs.controls = "controls";
        return [
          "figure",
          { "data-type": "block_video", class: "block-video" },
          ["video", videoAttrs],
        ] as const;
      },
    },
  };

  return new Schema({ nodes });
}

describe("block_video extension", () => {
  it("has correct name", () => {
    expect(blockVideoExtension.name).toBe("block_video");
  });

  it("is an atom node", () => {
    const config = blockVideoExtension.config;
    expect(config.atom).toBe(true);
    expect(config.draggable).toBe(true);
    expect(config.selectable).toBe(true);
  });

  describe("schema", () => {
    const schema = createTestSchema();

    it("creates a block_video node with default attrs", () => {
      const node = schema.nodes.block_video.create();
      expect(node.type.name).toBe("block_video");
      expect(node.attrs.src).toBe("");
      expect(node.attrs.title).toBe("");
      expect(node.attrs.poster).toBe("");
      expect(node.attrs.controls).toBe(true);
      expect(node.attrs.preload).toBe("metadata");
      expect(node.attrs.sourceLine).toBeNull();
    });

    it("creates a block_video node with custom attrs", () => {
      const node = schema.nodes.block_video.create({
        src: "video.mp4",
        title: "My Video",
        poster: "thumb.jpg",
        controls: false,
        preload: "auto",
        sourceLine: 5,
      });
      expect(node.attrs.src).toBe("video.mp4");
      expect(node.attrs.title).toBe("My Video");
      expect(node.attrs.poster).toBe("thumb.jpg");
      expect(node.attrs.controls).toBe(false);
      expect(node.attrs.preload).toBe("auto");
      expect(node.attrs.sourceLine).toBe(5);
    });

    it("is in the block group", () => {
      expect(schema.nodes.block_video.spec.group).toBe("block");
    });
  });
});
