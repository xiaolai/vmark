/**
 * Block Audio Tiptap Node
 *
 * Purpose: Defines the block_audio node type — standalone audio players rendered as
 * `<figure>` elements with a custom NodeView for playback and editing.
 *
 * Key decisions:
 *   - `atom: true` makes the audio player a single selectable unit
 *   - Simpler than video — no poster, no width/height attrs
 *   - Full-width player capped at `max-width: 600px`
 *   - `controls: true` by default for immediate playability
 *
 * @coordinates-with BlockAudioNodeView.ts — custom NodeView with audio loading
 * @coordinates-with shared/sourceLineAttr.ts — source line tracking for cursor sync
 * @module plugins/blockAudio/tiptap
 */

import "./block-audio.css";
import { Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { BlockAudioNodeView } from "./BlockAudioNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";

export const blockAudioExtension = Node.create({
  name: "block_audio",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  marks: "",
  defining: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      src: { default: "" },
      title: { default: "" },
      controls: { default: true },
      preload: { default: "metadata" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="block_audio"]',
        getAttrs: (dom) => {
          const audio = (dom as HTMLElement).querySelector("audio");
          return {
            src: audio?.getAttribute("src") ?? "",
            title: audio?.getAttribute("title") ?? "",
            controls: audio?.hasAttribute("controls") ?? true,
            preload: audio?.getAttribute("preload") ?? "metadata",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const audioAttrs: Record<string, string> = {
      src: String(node.attrs.src ?? ""),
      preload: String(node.attrs.preload ?? "metadata"),
    };
    if (node.attrs.title) audioAttrs.title = String(node.attrs.title);
    if (node.attrs.controls) audioAttrs.controls = "controls";

    return [
      "figure",
      {
        ...HTMLAttributes,
        "data-type": "block_audio",
        class: "block-audio",
      },
      ["audio", audioAttrs],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const safeGetPos = typeof getPos === "function" ? getPos : () => undefined;
      return new BlockAudioNodeView(node, safeGetPos, editor) as unknown as NodeView;
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        if (!(state.selection instanceof NodeSelection)) return false;
        if (state.selection.node.type.name !== "block_audio") return false;

        const pos = state.selection.to;
        editor
          .chain()
          .insertContentAt(pos, { type: "paragraph" })
          .setTextSelection(pos + 1)
          .run();
        return true;
      },

      ArrowUp: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        if ($from.parentOffset === 0) {
          const before = $from.before();
          if (before > 0) {
            const nodeBefore = state.doc.resolve(before).nodeBefore;
            if (nodeBefore?.type.name === "block_audio") {
              const audioPos = before - nodeBefore.nodeSize;
              editor.commands.setNodeSelection(audioPos);
              return true;
            }
          }
        }
        return false;
      },

      ArrowDown: ({ editor }) => {
        const { state } = editor;
        const { $to } = state.selection;

        if ($to.parentOffset === $to.parent.content.size) {
          const after = $to.after();
          if (after < state.doc.content.size) {
            const nodeAfter = state.doc.resolve(after).nodeAfter;
            if (nodeAfter?.type.name === "block_audio") {
              editor.commands.setNodeSelection(after);
              return true;
            }
          }
        }
        return false;
      },
    };
  },
});
