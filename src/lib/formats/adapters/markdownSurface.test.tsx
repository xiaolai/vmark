// @vitest-environment node
// WI-13 — the markdown WYSIWYG surface as a lazily-imported module.
//
// The surface moved out of `markdown.tsx` so the adapter module (evaluated by
// `bootstrapFormats()` in every window, before `import("./App")`) no longer
// statically imports Tiptap. What this file pins is the module CONTRACT that
// the move introduced and that nothing else can catch:
//
//   - `React.lazy` reads `.default`, and this module exports only a NAME — the
//     adapter's thunk maps one to the other at the import site. A rename on
//     either side of that mapping produces `{ default: undefined }`, which
//     React renders as nothing: a blank editor, in production, on the primary
//     format, with every existing test still green because they all import the
//     named export directly.
//   - The adapter's thunk must point at THIS module. A thunk aimed at the
//     wrong path also fails only at first mount.
//
// Render behavior of the surface itself is covered where it already was:
// src/components/Editor/Editor.test.tsx mounts it through the real dispatcher.

import { describe, expect, it } from "vitest";
import * as surfaceModule from "./markdownSurface";
import { markdownFormat } from "./markdown";

describe("markdownSurface module contract", () => {
  it("exports the surface under the name the adapter's thunk maps", () => {
    expect(typeof surfaceModule.MarkdownEditorSurface).toBe("function");
  });

  it("is a props-taking component, not a factory", () => {
    // A zero-arg function here would mean the module exported the thunk by
    // mistake — which React.lazy would happily render as an empty component.
    expect(surfaceModule.MarkdownEditorSurface.length).toBe(1);
  });

  it("is what the markdown adapter's wysiwygComponent thunk resolves to", async () => {
    const loaded = await markdownFormat.wysiwygComponent!();
    // Not merely "defined": the exact component. `{ default: undefined }` is
    // what a rename on either side of the mapping produces, and it renders as
    // an empty editor rather than throwing.
    expect(loaded.default).toBe(surfaceModule.MarkdownEditorSurface);
  });
});
