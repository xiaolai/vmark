/**
 * HTML Sanitizer for Export
 *
 * Purpose: Clean up ProseMirror/Tiptap internal elements and attributes
 * from rendered HTML before export. Removes editor-specific artifacts
 * that shouldn't appear in exported documents.
 *
 * @module export/htmlSanitizer
 * @coordinates-with htmlExport.ts — called before resource resolution
 */

/**
 * Sanitize HTML by removing editor-specific artifacts.
 * This cleans up ProseMirror/Tiptap internal elements and attributes
 * that shouldn't appear in exported HTML.
 */
export function sanitizeExportHtml(html: string): string {
  // Create a temporary DOM to manipulate
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const container = doc.body.firstElementChild as HTMLElement;

  // Remove ProseMirror internal elements
  container.querySelectorAll(".ProseMirror-separator, .ProseMirror-trailingBreak").forEach(el => el.remove());

  // Remove hidden HTML preview blocks (render them as actual content or remove)
  container.querySelectorAll(".html-preview-block, .html-preview-inline").forEach(el => {
    // These are hidden placeholders - remove them entirely
    // The actual HTML content is escaped in data-value, but rendering raw HTML is risky
    el.remove();
  });

  // Remove editor-specific attributes from all elements
  const editorAttrs = [
    "contenteditable",
    "draggable",
    "sourceline",
    "data-render-mode",
  ];

  container.querySelectorAll("*").forEach(el => {
    editorAttrs.forEach(attr => el.removeAttribute(attr));

    // Clean up inline styles that are editor-specific
    const style = el.getAttribute("style");
    if (style) {
      // Remove display:none from non-hidden elements
      // Keep opacity for images
      const cleanStyle = style
        .replace(/display:\s*none;?/gi, "")
        .trim();
      if (cleanStyle) {
        el.setAttribute("style", cleanStyle);
      } else {
        el.removeAttribute("style");
      }
    }
  });

  // Note: asset:// URLs are handled by resolveResources after sanitization
  // Don't remove them here - they need to be resolved to file paths or data URIs

  // Remove empty paragraphs that only contain ProseMirror artifacts
  container.querySelectorAll("p").forEach(p => {
    if (p.innerHTML.trim() === "" || p.innerHTML === "<br>") {
      // Keep empty paragraphs for spacing, but clean them
      p.innerHTML = "";
    }
  });

  return container.innerHTML;
}
