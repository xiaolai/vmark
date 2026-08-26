/**
 * Block Audio Tiptap Node
 *
 * Purpose: Defines the block_audio node type — standalone audio players rendered as
 * `<figure>` elements with a custom NodeView for playback and editing.
 *
 * Key decisions:
 *   - `ownerTabId` names the document these nodes belong to, so a relative
 *     `src` resolves against ITS directory rather than the focused tab's.
 *     Full reasoning on the option itself and in
 *     `services/assembly/blockMediaExtensions.ts`.
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
import { BlockAudioNodeView } from "./BlockAudioNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { mediaBlockKeyboardShortcuts } from "../shared/mediaNodeViewHelpers";
import { referenceIdentityAttrs } from "@/utils/referenceIdentity";

/** Tiptap node extension for block-level audio elements. */
export interface BlockAudioExtensionOptions {
  /**
   * The tab whose document owns these nodes, so a relative `src` resolves
   * against ITS directory rather than against whichever tab currently has
   * focus. Configured per editor by `services/assembly/tiptapExtensions.ts`.
   *
   * `undefined` keeps the previous focused-tab behaviour, which is the right
   * answer when nothing owns the editor (a preview with no tab behind it). It
   * is the WRONG answer for a split view: the unfocused pane resolved against
   * the other document, and changed its answer as focus moved.
   */
  ownerTabId: string | undefined;
}

export const blockAudioExtension = Node.create<BlockAudioExtensionOptions>({
  name: "block_audio",

  addOptions() {
    return { ownerTabId: undefined };
  },

  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  marks: "",
  defining: true,

  addAttributes() {
    return {
      ...referenceIdentityAttrs,
      ...sourceLineAttr,
      src: { default: "" },
      alt: { default: "" },
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
    /* v8 ignore start -- @preserve reason: addNodeView factory callback only runs in live Tiptap editor; not exercised in unit tests */
    return ({ node, getPos, editor }) => {
      const safeGetPos = typeof getPos === "function" ? getPos : () => undefined;
      return new BlockAudioNodeView(node, safeGetPos, editor, this.options.ownerTabId);
    };
    /* v8 ignore stop */
  },

  addKeyboardShortcuts() {
    return mediaBlockKeyboardShortcuts("block_audio");
  },
});
