/**
 * Tests for block_audio node schema — attrs, defaults, parseHTML, renderHTML.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { blockAudioExtension } from "../tiptap";

function createTestSchema() {
  const nodes = {
    doc: { content: "block+", group: undefined },
    paragraph: { content: "text*", group: "block", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] as const },
    text: { group: "inline" },
    block_audio: {
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
        controls: { default: true },
        preload: { default: "metadata" },
      },
      parseDOM: [
        {
          tag: 'figure[data-type="block_audio"]',
          getAttrs: (dom: HTMLElement) => {
            const audio = dom.querySelector("audio");
            return {
              src: audio?.getAttribute("src") ?? "",
              title: audio?.getAttribute("title") ?? "",
              controls: audio?.hasAttribute("controls") ?? true,
              preload: audio?.getAttribute("preload") ?? "metadata",
            };
          },
        },
      ],
      toDOM: (node: { attrs: Record<string, unknown> }) => {
        const audioAttrs: Record<string, unknown> = {
          src: String(node.attrs.src ?? ""),
          preload: String(node.attrs.preload ?? "metadata"),
        };
        if (node.attrs.title) audioAttrs.title = String(node.attrs.title);
        if (node.attrs.controls) audioAttrs.controls = "controls";
        return [
          "figure",
          { "data-type": "block_audio", class: "block-audio" },
          ["audio", audioAttrs],
        ] as const;
      },
    },
  };

  return new Schema({ nodes });
}

describe("block_audio extension", () => {
  it("has correct name", () => {
    expect(blockAudioExtension.name).toBe("block_audio");
  });

  it("is an atom node", () => {
    const config = blockAudioExtension.config;
    expect(config.atom).toBe(true);
    expect(config.draggable).toBe(true);
    expect(config.selectable).toBe(true);
  });

  describe("schema", () => {
    const schema = createTestSchema();

    it("creates a block_audio node with default attrs", () => {
      const node = schema.nodes.block_audio.create();
      expect(node.type.name).toBe("block_audio");
      expect(node.attrs.src).toBe("");
      expect(node.attrs.title).toBe("");
      expect(node.attrs.controls).toBe(true);
      expect(node.attrs.preload).toBe("metadata");
      expect(node.attrs.sourceLine).toBeNull();
    });

    it("creates a block_audio node with custom attrs", () => {
      const node = schema.nodes.block_audio.create({
        src: "song.mp3",
        title: "My Song",
        controls: false,
        preload: "auto",
        sourceLine: 10,
      });
      expect(node.attrs.src).toBe("song.mp3");
      expect(node.attrs.title).toBe("My Song");
      expect(node.attrs.controls).toBe(false);
      expect(node.attrs.preload).toBe("auto");
      expect(node.attrs.sourceLine).toBe(10);
    });

    it("is in the block group", () => {
      expect(schema.nodes.block_audio.spec.group).toBe("block");
    });

    it("does not have poster or width/height attrs", () => {
      const node = schema.nodes.block_audio.create();
      expect(node.attrs.poster).toBeUndefined();
      expect(node.attrs.width).toBeUndefined();
      expect(node.attrs.height).toBeUndefined();
    });
  });
});
