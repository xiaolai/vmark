/**
 * Export Utilities (Pure)
 *
 * Pure functions for markdown-to-HTML conversion and styling.
 * Async operations (file saving, clipboard) are in hooks/useExportOperations.
 */

import DOMPurify from "dompurify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Root, Blockquote, Paragraph, Text, Parent, Content } from "mdast";
import type { Alert, AlertType, Details, WikiLink, WikiEmbed, Highlight, Underline, Subscript, Superscript } from "@/utils/markdownPipeline/types";
import { parseMarkdownToMdast } from "@/utils/markdownPipeline/parser";
import type { MarkdownPipelineOptions } from "@/utils/markdownPipeline/types";

const ALERT_TYPES: AlertType[] = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

/**
 * GitHub-style CSS for exported HTML
 */
export const EXPORT_CSS = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #1f2328;
  background-color: #ffffff;
  max-width: 900px;
  margin: 0 auto;
  padding: 32px;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

h1 { font-size: 2em; border-bottom: 1px solid #d1d5da; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d1d5da; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #656d76; }

p { margin-top: 0; margin-bottom: 16px; }

a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }

code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 85%;
  background-color: #f6f8fa;
  padding: 0.2em 0.4em;
  border-radius: 6px;
}

pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 85%;
  background-color: #f6f8fa;
  padding: 16px;
  overflow: auto;
  border-radius: 6px;
  line-height: 1.45;
}

pre code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
}

blockquote {
  margin: 0 0 16px 0;
  padding: 0 1em;
  color: #656d76;
  border-left: 0.25em solid #d1d5da;
}

ul, ol {
  margin-top: 0;
  margin-bottom: 16px;
  padding-left: 2em;
}

li { margin-top: 0.25em; }
li + li { margin-top: 0.25em; }

table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 16px;
}

th, td {
  padding: 6px 13px;
  border: 1px solid #d1d5da;
}

th {
  font-weight: 600;
  background-color: #f6f8fa;
}

tr:nth-child(2n) { background-color: #f6f8fa; }

hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: #d1d5da;
  border: 0;
}

img {
  max-width: 100%;
  height: auto;
}

/* Task lists */
.task-list-item {
  list-style-type: none;
}

.task-list-item input {
  margin-right: 0.5em;
}

/* Alert blocks (GFM) */
.markdown-alert {
  padding: 8px 16px;
  margin-bottom: 16px;
  border-left: 4px solid;
  border-radius: 6px;
}

.markdown-alert-note { border-color: #0969da; background-color: #ddf4ff; }
.markdown-alert-tip { border-color: #1a7f37; background-color: #dafbe1; }
.markdown-alert-important { border-color: #8250df; background-color: #fbefff; }
.markdown-alert-warning { border-color: #9a6700; background-color: #fff8c5; }
.markdown-alert-caution { border-color: #cf222e; background-color: #ffebe9; }

mark {
  background-color: #fff8c5;
  color: inherit;
}

details {
  margin: 0 0 16px 0;
  padding: 8px 12px;
  border: 1px solid #d1d5da;
  border-radius: 6px;
  background-color: #f6f8fa;
}

summary {
  font-weight: 600;
  cursor: pointer;
}

.wiki-link {
  color: #0969da;
  text-decoration: none;
}

.wiki-embed {
  color: #57606a;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

.math-inline,
.math-block {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  background-color: #f6f8fa;
  padding: 0.1em 0.3em;
  border-radius: 4px;
}

.math-block {
  display: block;
  padding: 8px 12px;
  margin: 12px 0;
}

.mermaid {
  background-color: #f6f8fa;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}

@media print {
  body { max-width: none; padding: 0; }
  pre { white-space: pre-wrap; word-wrap: break-word; }
}
`.trim();

const DOMPURIFY_CONFIG = {
  ADD_TAGS: ["details", "summary"],
  ADD_ATTR: ["open"],
};

function stripAlertMarker(
  paragraph: Paragraph
): { alertType: AlertType; paragraph: Paragraph | null } | null {
  const children = [...(paragraph.children ?? [])];
  const first = children[0];
  if (!first || first.type !== "text") return null;

  const match = (first as Text).value.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+)?/i);
  if (!match) return null;

  const alertType = match[1].toUpperCase() as AlertType;
  if (!ALERT_TYPES.includes(alertType)) return null;

  const rest = (first as Text).value.slice(match[0].length);
  if (rest.length > 0) {
    children[0] = { ...(first as Text), value: rest };
  } else {
    children.shift();
  }

  if (children[0]?.type === "break") {
    children.shift();
  }

  const nextParagraph = children.length > 0 ? { ...paragraph, children } : null;
  return { alertType, paragraph: nextParagraph };
}

function convertBlockquoteToAlert(node: Blockquote): Alert | null {
  const firstChild = node.children[0];
  if (!firstChild || firstChild.type !== "paragraph") return null;

  const stripped = stripAlertMarker(firstChild as Paragraph);
  if (!stripped) return null;

  const alertChildren: Content[] = [];
  if (stripped.paragraph) {
    alertChildren.push(stripped.paragraph);
  }
  alertChildren.push(...node.children.slice(1));

  return {
    type: "alert",
    alertType: stripped.alertType,
    children: alertChildren,
  } as Alert;
}

function transformAlertBlockquotes(tree: Root): void {
  visit(tree, "blockquote", (node, index, parent) => {
    if (!parent || typeof index !== "number") return;
    const alert = convertBlockquoteToAlert(node as Blockquote);
    if (!alert) return;
    (parent as Parent).children[index] = alert as unknown as Content;
  });
}

function removeFrontmatter(tree: Root): void {
  tree.children = tree.children.filter((node) => node.type !== "yaml");
}

function buildWikiLabel(node: WikiLink | WikiEmbed): string {
  const alias = node.alias ? `|${node.alias}` : "";
  return `${node.value}${alias}`;
}

const rehypeHandlers = {
  alert(state: { all: (node: Alert) => unknown[] }, node: Alert) {
    const alertType = node.alertType || "NOTE";
    const className = ["markdown-alert", `markdown-alert-${alertType.toLowerCase()}`];
    return {
      type: "element",
      tagName: "div",
      properties: { className },
      children: state.all(node),
    };
  },
  details(state: { all: (node: Details) => unknown[] }, node: Details) {
    const summaryText = node.summary || "Details";
    const summaryNode = {
      type: "element",
      tagName: "summary",
      properties: {},
      children: [{ type: "text", value: summaryText }],
    };
    const children = state.all(node);
    const properties = node.open ? { open: true } : {};
    return {
      type: "element",
      tagName: "details",
      properties,
      children: [summaryNode, ...children],
    };
  },
  wikiLink(_state: unknown, node: WikiLink) {
    const text = node.alias || node.value;
    return {
      type: "element",
      tagName: "a",
      properties: { className: ["wiki-link"], href: `#${encodeURIComponent(node.value)}` },
      children: [{ type: "text", value: text }],
    };
  },
  wikiEmbed(_state: unknown, node: WikiEmbed) {
    return {
      type: "element",
      tagName: "span",
      properties: { className: ["wiki-embed"] },
      children: [{ type: "text", value: `![[${buildWikiLabel(node)}]]` }],
    };
  },
  highlight(state: { all: (node: Highlight) => unknown[] }, node: Highlight) {
    return {
      type: "element",
      tagName: "mark",
      properties: {},
      children: state.all(node),
    };
  },
  underline(state: { all: (node: Underline) => unknown[] }, node: Underline) {
    return {
      type: "element",
      tagName: "u",
      properties: {},
      children: state.all(node),
    };
  },
  subscript(state: { all: (node: Subscript) => unknown[] }, node: Subscript) {
    return {
      type: "element",
      tagName: "sub",
      properties: {},
      children: state.all(node),
    };
  },
  superscript(state: { all: (node: Superscript) => unknown[] }, node: Superscript) {
    return {
      type: "element",
      tagName: "sup",
      properties: {},
      children: state.all(node),
    };
  },
  inlineMath(_state: unknown, node: { value?: string }) {
    return {
      type: "element",
      tagName: "span",
      properties: { className: ["math-inline"] },
      children: [{ type: "text", value: node.value || "" }],
    };
  },
  math(_state: unknown, node: { value?: string }) {
    return {
      type: "element",
      tagName: "div",
      properties: { className: ["math-block"] },
      children: [{ type: "text", value: node.value || "" }],
    };
  },
  code(_state: unknown, node: { lang?: string; value?: string }) {
    const lang = node.lang ? String(node.lang) : "";
    const value = node.value || "";
    if (lang.toLowerCase() === "mermaid") {
      return {
        type: "element",
        tagName: "div",
        properties: { className: ["mermaid"] },
        children: [{ type: "text", value }],
      };
    }
    const className = lang ? [`language-${lang}`] : [];
    return {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "code",
          properties: className.length ? { className } : {},
          children: [{ type: "text", value }],
        },
      ],
    };
  },
} as const;

const htmlProcessor = unified()
  .use(remarkRehype, {
    allowDangerousHtml: true,
    handlers: rehypeHandlers,
  })
  .use(rehypeStringify, { allowDangerousHtml: true });

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convert markdown to HTML (sanitized to prevent XSS)
 */
export function markdownToHtml(
  markdown: string,
  options: MarkdownPipelineOptions = {}
): string {
  const mdast = parseMarkdownToMdast(markdown, options);
  removeFrontmatter(mdast);
  transformAlertBlockquotes(mdast);

  const hast = htmlProcessor.runSync(mdast as Root);
  const rawHtml = htmlProcessor.stringify(hast);
  return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
}

/**
 * Generate complete HTML document with styles
 */
export function generateHtmlDocument(
  markdown: string,
  title: string = "Document",
  includeStyles: boolean = true,
  options: MarkdownPipelineOptions = {}
): string {
  const htmlContent = markdownToHtml(markdown, options);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${includeStyles ? `<style>${EXPORT_CSS}</style>` : ""}
</head>
<body>
${htmlContent}
</body>
</html>`;
}

/**
 * Apply inline styles for PDF rendering
 */
export function applyPdfStyles(container: HTMLElement): void {
  // Headings
  container.querySelectorAll("h1").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "font-size: 24px; font-weight: 600; margin: 20px 0 12px; border-bottom: 1px solid #d1d5da; padding-bottom: 8px;";
  });
  container.querySelectorAll("h2").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "font-size: 20px; font-weight: 600; margin: 18px 0 10px; border-bottom: 1px solid #d1d5da; padding-bottom: 6px;";
  });
  container.querySelectorAll("h3").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "font-size: 16px; font-weight: 600; margin: 16px 0 8px;";
  });
  container.querySelectorAll("h4, h5, h6").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "font-size: 14px; font-weight: 600; margin: 14px 0 6px;";
  });

  // Code blocks
  container.querySelectorAll("pre").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "background-color: #f6f8fa; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 12px; overflow: auto; white-space: pre-wrap; word-wrap: break-word;";
  });
  container.querySelectorAll("code").forEach((el) => {
    if ((el as HTMLElement).parentElement?.tagName !== "PRE") {
      (el as HTMLElement).style.cssText =
        "background-color: #f6f8fa; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px;";
    }
  });

  // Blockquotes
  container.querySelectorAll("blockquote").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "margin: 0 0 12px 0; padding: 0 12px; color: #656d76; border-left: 4px solid #d1d5da;";
  });

  // Tables
  container.querySelectorAll("table").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "border-collapse: collapse; width: 100%; margin-bottom: 12px;";
  });
  container.querySelectorAll("th, td").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "padding: 6px 12px; border: 1px solid #d1d5da;";
  });
  container.querySelectorAll("th").forEach((el) => {
    (el as HTMLElement).style.cssText +=
      "font-weight: 600; background-color: #f6f8fa;";
  });

  // Links
  container.querySelectorAll("a").forEach((el) => {
    (el as HTMLElement).style.cssText = "color: #0969da; text-decoration: none;";
  });

  // Horizontal rules
  container.querySelectorAll("hr").forEach((el) => {
    (el as HTMLElement).style.cssText =
      "height: 2px; margin: 20px 0; background-color: #d1d5da; border: 0;";
  });

  // Alert blocks
  container.querySelectorAll(".markdown-alert").forEach((el) => {
    (el as HTMLElement).style.cssText +=
      "padding: 8px 16px; margin-bottom: 16px; border-left: 4px solid; border-radius: 6px;";
  });

  // Details blocks
  container.querySelectorAll("details").forEach((el) => {
    (el as HTMLElement).style.cssText +=
      "margin: 0 0 16px 0; padding: 8px 12px; border: 1px solid #d1d5da; border-radius: 6px; background-color: #f6f8fa;";
  });
  container.querySelectorAll("summary").forEach((el) => {
    (el as HTMLElement).style.cssText += "font-weight: 600;";
  });

  // Mermaid blocks
  container.querySelectorAll(".mermaid").forEach((el) => {
    (el as HTMLElement).style.cssText +=
      "background-color: #f6f8fa; border-radius: 6px; padding: 12px; overflow-x: auto;";
  });

  // Math blocks
  container.querySelectorAll(".math-inline, .math-block").forEach((el) => {
    (el as HTMLElement).style.cssText +=
      "font-family: monospace; background-color: #f6f8fa; border-radius: 4px; padding: 2px 4px;";
  });
  container.querySelectorAll(".math-block").forEach((el) => {
    (el as HTMLElement).style.cssText += "display: block; padding: 8px 12px; margin: 12px 0;";
  });

  // Images
  container.querySelectorAll("img").forEach((el) => {
    (el as HTMLElement).style.cssText = "max-width: 100%; height: auto;";
  });
}
