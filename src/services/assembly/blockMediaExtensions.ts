/**
 * The three block-media node types, bound to the document that owns them.
 *
 * Purpose: `block_image`, `block_video` and `block_audio` differ only in the
 * element they render; they take the same option for the same reason, and
 * registering them as a group keeps that shared reason in one place.
 *
 * The option is the point. Each node view resolves a relative `src` against a
 * DOCUMENT's directory, and it learns which document from `ownerTabId`. Left
 * unset, the resolver falls back to whichever tab currently has focus — right
 * often enough that nothing looks broken, until two documents are open in a
 * split (#1081) and the unfocused pane starts resolving against the other
 * document, changing its answer as focus moves.
 *
 * `undefined` is a legitimate value, not a missing one: an editor with no tab
 * behind it (a preview) has no owner, and the focused-tab fallback is correct
 * there.
 *
 * @coordinates-with services/assembly/tiptapExtensions.ts — the sole caller
 * @coordinates-with services/media/resolveMediaSrc.ts — consumes the owner
 * @module services/assembly/blockMediaExtensions
 */

import type { Extensions } from "@tiptap/react";
import { blockImageExtension } from "@/plugins/blockImage/tiptap";
import { blockVideoExtension } from "@/plugins/blockVideo/tiptap";
import { blockAudioExtension } from "@/plugins/blockAudio/tiptap";

/** Configure the block-media node types for the editor owned by `tabId`. */
export function blockMediaExtensions(tabId: string | undefined): Extensions {
  return [
    blockImageExtension.configure({ ownerTabId: tabId }),
    blockVideoExtension.configure({ ownerTabId: tabId }),
    blockAudioExtension.configure({ ownerTabId: tabId }),
  ];
}
