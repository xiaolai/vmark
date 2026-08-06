/**
 * Code Block Conversion — text serialization
 *
 * Purpose: Projects ProseMirror block/inline nodes to the plain-text lines a
 * code-block conversion emits. Every node the schema can place in a covered
 * range must produce SOMETHING here — content silently vanishing during a
 * "turn this into code" action is data loss, so atoms serialize their
 * canonical markdown-ish form instead of being dropped.
 *
 * @coordinates-with wysiwygAdapterCodeBlock.ts — sole consumer
 * @module plugins/toolbarActions/codeBlockSerialize
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildEmbedUrl, type VideoProvider } from "@/utils/videoProviderRegistry";

/** Markdown-ish text of one inline atom, or null when it has none. */
function inlineAtomText(child: PMNode): string | null {
  switch (child.type.name) {
    case "hardBreak":
      return "\n";
    case "math_inline":
      return `$${String(child.attrs.content ?? "")}$`;
    case "html_inline":
      return String(child.attrs.value ?? "");
    case "footnote_reference":
      return `[^${String(child.attrs.label ?? "")}]`;
    default:
      return null;
  }
}

/**
 * Text of one textblock with hard breaks preserved as newlines and inline
 * atoms (math, inline HTML, footnote refs, images) kept in a text form.
 * `textContent` alone would silently fuse `a<br>b` into `ab` and erase atoms.
 */
export function textblockText(node: PMNode): string {
  let text = "";
  node.forEach((child) => {
    if (child.isText) {
      text += child.text ?? "";
      return;
    }
    const atom = inlineAtomText(child);
    if (atom !== null) {
      text += atom;
    } else if (typeof child.attrs.src === "string" && child.attrs.src) {
      text += child.attrs.src;
    } else {
      text += child.textContent;
    }
  });
  return text;
}

/** Append one text line per list item to `lines`, indenting nested lists. */
export function collectListLines(list: PMNode, indent: number, lines: string[]): void {
  list.forEach((item) => {
    item.forEach((child) => {
      if (child.type.name === "bulletList" || child.type.name === "orderedList") {
        collectListLines(child, indent + 1, lines);
      } else {
        collectBlockLines(child, indent, lines);
      }
    });
  });
}

/** Push every line of `value` with the given indent. */
function pushLines(value: string, indent: number, lines: string[]): void {
  for (const line of value.split("\n")) {
    lines.push(line ? "  ".repeat(indent) + line : "");
  }
}

/** Markdown-ish lines of a leaf block. Nothing here may silently vanish. */
function collectLeafLines(node: PMNode, indent: number, lines: string[]): void {
  const name = node.type.name;
  const pad = "  ".repeat(indent);
  if (name === "horizontalRule") {
    lines.push(pad + "---");
  } else if (typeof node.attrs.src === "string" && node.attrs.src) {
    lines.push(pad + node.attrs.src);
  } else if (name === "video_embed") {
    const { provider, videoId, privacyHash } = node.attrs as {
      provider?: string;
      videoId?: string;
      privacyHash?: string | null;
    };
    const url =
      provider && videoId
        ? buildEmbedUrl(provider as VideoProvider, videoId, { privacyHash: privacyHash ?? null })
        : "about:blank";
    if (url !== "about:blank") lines.push(pad + url);
  } else if (name === "frontmatter") {
    pushLines(`---\n${String(node.attrs.value ?? "")}\n---`, indent, lines);
  } else if (name === "html_block") {
    pushLines(String(node.attrs.value ?? ""), indent, lines);
  } else if (name === "toc") {
    lines.push(pad + "[TOC]");
  } else if (node.textContent) {
    // Unknown leaf: fall back to visible text rather than dropping it.
    lines.push(pad + node.textContent);
  }
}

/** Append the text lines of any block node: textblocks one line, lists per item. */
export function collectBlockLines(node: PMNode, indent: number, lines: string[]): void {
  const name = node.type.name;
  if (name === "bulletList" || name === "orderedList") {
    collectListLines(node, indent, lines);
    return;
  }
  if (node.isTextblock) {
    const text = textblockText(node);
    lines.push(text ? "  ".repeat(indent) + text : "");
    return;
  }
  if (node.isLeaf) {
    collectLeafLines(node, indent, lines);
    return;
  }
  // blockquote / details / alert wrappers — flatten their children
  node.forEach((child) => collectBlockLines(child, indent, lines));
}
