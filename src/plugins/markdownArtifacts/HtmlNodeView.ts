/**
 * HTML Node View (Block + Inline)
 *
 * Purpose: Renders raw HTML nodes in WYSIWYG mode with configurable rendering modes
 * (hidden, sanitized, sanitized-with-styles). Subscribes to settings store to
 * live-update when the user changes the HTML rendering preference.
 *
 * Key decisions:
 *   - Single BaseHtmlNodeView class handles both inline and block variants to avoid duplication.
 *   - Double-click triggers Source mode switch with cursor sync via sourceLine attribute,
 *     because raw HTML can only be meaningfully edited in source.
 *   - HTML is sanitized before innerHTML injection to prevent XSS from user content.
 *   - Embedded media (`img`/`source`) keeps its ORIGINAL relative `src`/`srcset`
 *     in the document for portability, but the rendered DOM rewrites it to the
 *     resolved asset URL — otherwise the webview resolves the relative path
 *     against its own origin and shows a broken image.
 *
 * @coordinates-with htmlBlock.ts, htmlInline.ts — factory functions wrap this view
 * @coordinates-with settingsStore.ts — subscribes to `markdown.htmlRenderingMode`,
 *   `htmlAllowlistLevel`, and `htmlAllowlistCustomTags`
 * @coordinates-with utils/htmlAllowlists.ts — parseCustomTags for the custom field
 * @coordinates-with plugins/shared/resolveMediaPath.ts — the embedded-media resolver
 * @module plugins/markdownArtifacts/HtmlNodeView
 */
import { hostSettings, type HtmlRendering } from "@/plugins/shared/hostSettings";
import { hostDocument } from "@/plugins/shared/hostDocument";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import type { HtmlAllowlistLevel } from "@/utils/htmlAllowlists";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { toggleSourceModeWithCheckpoint } from "@/services/history/unifiedHistory";
import { sanitizeHtmlPreview } from "@/utils/sanitize";
import { parseCustomTags } from "@/utils/htmlAllowlists";
import { resolveImageSrc, snapshotActiveFilePath } from "@/plugins/shared/resolveMediaPath";
import type { CursorInfo } from "@/types/cursorSync";

interface HtmlNodeViewOptions {
  inline: boolean;
  typeName: "html_inline" | "html_block";
  dataType: "html" | "html-block";
}

class BaseHtmlNodeView implements NodeView {
  dom: HTMLElement;

  private node: PMNode;
  private value: string;
  private renderMode: HtmlRendering["mode"];
  private allowlistLevel: HtmlAllowlistLevel;
  private customTags: string;
  private unsubscribe: (() => void) | null = null;
  private options: HtmlNodeViewOptions;
  /** Bumped each render; a stale in-flight resolution must not touch a newer fragment. */
  private renderGeneration = 0;

  constructor(node: PMNode, options: HtmlNodeViewOptions) {
    this.node = node;
    this.options = options;
    /* v8 ignore start -- @preserve value attr is always set on HTML nodes */
    this.value = String(node.attrs.value ?? "");
    /* v8 ignore stop */
    const html = hostSettings.htmlRendering();
    this.renderMode = html.mode;
    this.allowlistLevel = html.allowlistLevel;
    this.customTags = html.customTags;

    this.dom = document.createElement(options.inline ? "span" : "div");
    this.dom.setAttribute("data-type", options.dataType);
    this.dom.setAttribute("data-value", this.value);
    this.dom.setAttribute("contenteditable", "false");
    this.dom.className = options.inline ? "html-preview-inline" : "html-preview-block";

    // Double-click to switch to Source mode
    this.dom.addEventListener("dblclick", this.handleDoubleClick);

    this.render();

    this.unsubscribe = hostSettings.onChange(() => {
      const next = hostSettings.htmlRendering();
      if (
        next.mode === this.renderMode &&
        next.allowlistLevel === this.allowlistLevel &&
        next.customTags === this.customTags
      ) {
        return;
      }
      this.renderMode = next.mode;
      this.allowlistLevel = next.allowlistLevel;
      this.customTags = next.customTags;
      this.render();
    });
  }

  private handleDoubleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceLine = this.node.attrs.sourceLine as number | null;
    if (sourceLine !== null) {
      // Create cursor info to sync position
      const cursorInfo: CursorInfo = {
        sourceLine,
        wordAtCursor: "",
        offsetInWord: 0,
        nodeType: "paragraph", // HTML blocks treated as paragraph-like
        percentInLine: 0,
        contextBefore: "",
        contextAfter: "",
      };
      // Per ADR-009: cursorInfo lives per-document; setCursorInfo takes tabId.
      // Resolve the actual window label so cursor sync also works in
      // doc-* windows, not only the main one.
      hostDocument.reportCursorInfo(getCurrentWindowLabel(), cursorInfo);
    }

    // Switch to source mode via the checkpoint-aware path so undo history
    // and the per-doc mode mirror stay consistent.
    toggleSourceModeWithCheckpoint(getCurrentWindowLabel());
  };

  update(node: PMNode): boolean {
    if (node.type.name !== this.options.typeName) return false;

    this.node = node;
    const nextValue = String(node.attrs.value ?? "");
    if (nextValue !== this.value) {
      this.value = nextValue;
      this.render();
    }

    return true;
  }

  destroy(): void {
    this.dom.removeEventListener("dblclick", this.handleDoubleClick);
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  ignoreMutation(): boolean {
    return true;
  }

  private render(): void {
    this.dom.setAttribute("data-value", this.value);
    this.dom.setAttribute("data-render-mode", this.renderMode);

    if (this.renderMode === "hidden") {
      this.dom.style.display = "none";
      this.dom.innerHTML = "";
      return;
    }

    this.dom.style.display = this.options.inline ? "inline" : "block";

    const allowStyles = this.renderMode === "sanitizedWithStyles";
    this.dom.setAttribute("data-allow-styles", allowStyles ? "true" : "false");
    this.dom.innerHTML = sanitizeHtmlPreview(this.value, {
      allowStyles,
      context: this.options.inline ? "inline" : "block",
      allowlistLevel: this.allowlistLevel,
      customTags: parseCustomTags(this.customTags),
    });

    // Raw HTML keeps its ORIGINAL relative `src`/`srcset` in the document for
    // portability, but the webview resolves a relative URL against its own
    // origin, where no such file exists — so embedded media resolves through
    // the same path the Markdown image view uses. Whose document this is must
    // be read NOW: the awaits below give focus a chance to move (split pane).
    const generation = ++this.renderGeneration;
    const documentPath = snapshotActiveFilePath();
    void this.resolveEmbeddedMedia(generation, documentPath);
  }

  /**
   * Rewrite `src`/`srcset` on embedded media (`img`, `source`) onto their
   * resolved asset URLs, leaving the document value untouched.
   *
   * `generation` is a render epoch: when a settings change or an update
   * re-renders the node mid-flight, the stale loop must not paint its result
   * onto the new fragment.
   */
  private async resolveEmbeddedMedia(
    generation: number,
    documentPath: () => string | null,
  ): Promise<void> {
    const media = Array.from(
      this.dom.querySelectorAll<HTMLImageElement | HTMLSourceElement>("img, source"),
    );
    for (const el of media) {
      const src = el.getAttribute("src");
      if (src) {
        const resolved = await resolveImageSrc(src, documentPath);
        if (generation !== this.renderGeneration) return;
        if (resolved && resolved !== src) el.setAttribute("src", resolved);
      }

      const srcset = el.getAttribute("srcset");
      if (srcset) {
        const resolvedSrcset = await this.resolveSrcset(srcset, documentPath);
        if (generation !== this.renderGeneration) return;
        el.setAttribute("srcset", resolvedSrcset);
      }
    }
  }

  /** Resolve each candidate in a `srcset`, keeping its width/density descriptor. */
  private async resolveSrcset(
    srcset: string,
    documentPath: () => string | null,
  ): Promise<string> {
    const candidates = srcset.split(",");
    const resolved = await Promise.all(
      candidates.map(async (candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return "";
        // The URL is the leading token; everything after it is the descriptor.
        const match = /^(\S+)(\s+.*)?$/.exec(trimmed);
        if (!match) return trimmed;
        const url = match[1];
        const descriptor = match[2] ?? "";
        const resolvedUrl = await resolveImageSrc(url, documentPath);
        return resolvedUrl ? `${resolvedUrl}${descriptor}` : trimmed;
      }),
    );
    return resolved.filter(Boolean).join(", ");
  }
}

export function createHtmlInlineNodeView(node: PMNode): NodeView {
  return new BaseHtmlNodeView(node, {
    inline: true,
    typeName: "html_inline",
    dataType: "html",
  });
}

export function createHtmlBlockNodeView(node: PMNode): NodeView {
  return new BaseHtmlNodeView(node, {
    inline: false,
    typeName: "html_block",
    dataType: "html-block",
  });
}
