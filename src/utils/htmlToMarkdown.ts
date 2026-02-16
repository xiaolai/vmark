/**
 * HTML to Markdown Conversion
 *
 * Uses Turndown library to convert HTML content (from clipboard)
 * to clean Markdown for pasting into the editor.
 */

import TurndownService from "turndown";
import { tables } from "@joplin/turndown-plugin-gfm";
import { buildCodeMask } from "./markdownCodeMask";

/** Register inline formatting rules (strikethrough, underline, super/subscript, highlight). */
function registerInlineRules(turndown: TurndownService): void {
  turndown.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement: (content) => `~~${content}~~`,
  });

  turndown.addRule("underline", {
    filter: ["u"],
    replacement: (content) => `*${content}*`,
  });

  turndown.addRule("superscript", {
    filter: ["sup"],
    replacement: (content) => `^${content}^`,
  });

  turndown.addRule("subscript", {
    filter: ["sub"],
    replacement: (content) => `~${content}~`,
  });

  turndown.addRule("highlight", {
    filter: ["mark"],
    replacement: (content) => `==${content}==`,
  });
}

/** Register block-level rules (task lists, paragraphs, divs, spans, br). */
function registerBlockRules(turndown: TurndownService): void {
  turndown.addRule("taskListItem", {
    filter: (node) => {
      if (node.nodeName !== "LI") return false;
      const checkbox = node.querySelector('input[type="checkbox"]');
      return checkbox !== null;
    },
    replacement: (content, node) => {
      const checkbox = (node as Element).querySelector('input[type="checkbox"]');
      const checked = checkbox?.hasAttribute("checked") ?? false;
      const prefix = checked ? "- [x] " : "- [ ] ";
      const cleanContent = content.replace(/^\s*\[[ x]\]\s*/, "").trim();
      return prefix + cleanContent + "\n";
    },
  });

  const blockReplacement = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return "";
    return "\n\n" + trimmed + "\n\n";
  };

  turndown.addRule("paragraph", {
    filter: "p",
    replacement: blockReplacement,
  });

  turndown.addRule("div", {
    filter: "div",
    replacement: blockReplacement,
  });

  turndown.addRule("span", {
    filter: "span",
    replacement: (content) => content,
  });

  turndown.addRule("br", {
    filter: "br",
    replacement: () => "  \n",
  });
}

/**
 * Configure Turndown service with sensible defaults for clipboard content.
 */
function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
    linkReferenceStyle: "full",
  });

  turndown.remove(["script", "style", "noscript", "object", "embed"]);
  turndown.keep(["del", "ins", "iframe"]);

  registerInlineRules(turndown);
  registerBlockRules(turndown);

  // GFM tables: convert <table> HTML to GFM pipe-delimited tables.
  // Falls back to raw HTML (wrapped in <div class="joplin-table-wrapper">)
  // for complex tables with block content in cells.
  turndown.use(tables);

  return turndown;
}

// Singleton — the tables plugin uses module-level cached state, so only one
// TurndownService instance should use it per process.
let turndownInstance: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = createTurndownService();
  }
  return turndownInstance;
}

/**
 * Pre-process HTML to clean up common issues from Word and web pages.
 */
function preprocessHtml(html: string): string {
  // Create a temporary container to parse HTML
  if (typeof document === "undefined") {
    return html;
  }

  const container = document.createElement("div");
  container.innerHTML = html;

  // Remove all style attributes (common in Word paste)
  const elementsWithStyle = container.querySelectorAll("[style]");
  elementsWithStyle.forEach((el) => el.removeAttribute("style"));

  // Remove all class attributes
  const elementsWithClass = container.querySelectorAll("[class]");
  elementsWithClass.forEach((el) => el.removeAttribute("class"));

  // Remove Word-specific elements
  const wordElements = container.querySelectorAll(
    'meta, link, xml, o\\:p, [class^="Mso"], [style*="mso-"]'
  );
  wordElements.forEach((el) => el.remove());

  // Remove empty paragraphs and divs (but keep them if they have semantic meaning like <br>)
  const emptyBlocks = container.querySelectorAll("p:empty, div:empty");
  emptyBlocks.forEach((el) => {
    // Only remove if it has no child nodes at all
    if (el.childNodes.length === 0) {
      el.remove();
    }
  });

  // Convert <b> to <strong>, <i> to <em> for consistency
  const boldElements = container.querySelectorAll("b");
  boldElements.forEach((b) => {
    const strong = document.createElement("strong");
    strong.innerHTML = b.innerHTML;
    b.replaceWith(strong);
  });

  const italicElements = container.querySelectorAll("i");
  italicElements.forEach((i) => {
    const em = document.createElement("em");
    em.innerHTML = i.innerHTML;
    i.replaceWith(em);
  });

  return container.innerHTML;
}

/**
 * Post-process markdown to clean up common issues.
 */
function postprocessMarkdown(markdown: string): string {
  let result = markdown;

  // Remove excessive blank lines (more than 2 consecutive)
  result = result.replace(/\n{4,}/g, "\n\n\n");

  // Remove trailing whitespace from lines
  result = result.replace(/[ \t]+$/gm, "");

  // Ensure single trailing newline
  result = result.trimEnd() + "\n";

  // Strip Joplin table wrapper divs (emitted for complex tables the plugin can't
  // convert to GFM — block content in cells, nested tables, etc.)
  result = result.replace(/<div class="joplin-table-wrapper">([\s\S]*?)<\/div>/g, "$1");

  // Fix common turndown artifacts
  // Remove backslashes before characters that don't need escaping in most contexts.
  // Pipe (|) is stripped only outside GFM table rows, where \| is needed to
  // represent literal pipes inside cells.
  // Escapes inside code blocks/spans are preserved (code mask).
  const mask = buildCodeMask(result);
  result = result.replace(/\\([#\-*_`|[\]()>+.!])/g, (match, char, offset) => {
    // Never strip escapes inside code
    if (mask[offset]) return match;

    // Keep \| inside GFM table rows (lines starting with |)
    if (char === "|") {
      const lineStart = result.lastIndexOf("\n", offset - 1) + 1;
      const linePrefix = result.slice(lineStart, offset).trimStart();
      if (linePrefix.startsWith("|")) return match;
    }
    return char;
  });

  return result;
}

/**
 * Convert HTML to Markdown.
 *
 * @param html - HTML string to convert
 * @returns Clean Markdown string
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) {
    return "";
  }

  const preprocessed = preprocessHtml(html);
  const turndown = getTurndown();
  const markdown = turndown.turndown(preprocessed);
  return postprocessMarkdown(markdown);
}

/**
 * Check if HTML content is "substantial" enough to warrant conversion.
 * Simple HTML (just plain text wrapped in tags) should just be pasted as text.
 */
export function isSubstantialHtml(html: string): boolean {
  if (!html || !html.trim()) {
    return false;
  }

  // Check for meaningful HTML tags that would benefit from conversion
  const meaningfulTags = [
    /<h[1-6][^>]*>/i,
    /<(ul|ol|li)[^>]*>/i,
    /<(table|tr|td|th)[^>]*>/i,
    /<(strong|b|em|i|u|s|del|mark|code|pre)[^>]*>/i,
    /<a\s+[^>]*href/i,
    /<img\s+[^>]*src/i,
    /<blockquote[^>]*>/i,
    /<hr[^>]*>/i,
  ];

  for (const pattern of meaningfulTags) {
    if (pattern.test(html)) {
      return true;
    }
  }

  // Check if there are multiple paragraphs
  const paragraphCount = (html.match(/<p[^>]*>/gi) || []).length;
  if (paragraphCount > 1) {
    return true;
  }

  // Check if there are multiple divs that might be structural
  const divCount = (html.match(/<div[^>]*>/gi) || []).length;
  if (divCount > 2) {
    return true;
  }

  return false;
}

/**
 * Detect if HTML is from Microsoft Word.
 */
export function isWordHtml(html: string): boolean {
  return (
    html.includes("xmlns:w=") ||
    html.includes("urn:schemas-microsoft-com:office:word") ||
    html.includes("mso-") ||
    html.includes("MsoNormal") ||
    html.includes("<o:p>")
  );
}

/**
 * Detect if HTML is from a web page (has external resources or complex structure).
 */
export function isWebPageHtml(html: string): boolean {
  return (
    html.includes("<!DOCTYPE") ||
    html.includes("<html") ||
    html.includes("<head") ||
    html.includes("<body") ||
    /<link[^>]+stylesheet/i.test(html)
  );
}
