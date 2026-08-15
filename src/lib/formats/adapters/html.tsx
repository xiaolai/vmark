// WI-3.3 — Standalone HTML (.html / .htm) adapter.
//
// Per ADR-4 the preview renders inside <iframe sandbox="" srcdoc={...}>
// with an EMPTY sandbox allow-list (no allow-scripts, no
// allow-same-origin, no allow-forms, no allow-popups). The HTML
// content also gets an injected
//   <meta http-equiv="Content-Security-Policy"
//         content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
// which governs *resource loading inside the iframe*. The sandbox
// is enforced by the iframe attribute alone; CSP via <meta> is not
// honored as a sandbox per MDN.
//
// Defense-in-depth: DOMPurify sanitizes the content first, removing
// script tags + javascript: URLs + event handlers before the iframe
// renders anything. WI-3.4 (security review) is the gating sign-off
// before this adapter is considered production-ready; until then the
// adapter ships in code but is marked UNVERIFIED in the file header.
//
// Issue #1273 adds an OPT-IN second mode on top of this one, reached only by
// an explicit per-file confirmation. The default above is unchanged; see
// HtmlPreview.tsx for the two-mode renderer and src-tauri/src/trusted_html/
// for the isolated origin the trusted mode runs in.

import type { Extension } from "@codemirror/state";
import { registerFormat } from "../registry";
import { HtmlPreview } from "./HtmlPreview";
import type {
  FormatConfig,
  ValidationDiagnostic,
  Validator,
} from "../types";

/**
 * What the preview refuses to execute, and what to say about it.
 *
 * A table rather than three near-identical branches: they differed only by
 * regex, message and rule id, so every change had to be made three times and
 * a fourth rule meant a fourth copy.
 *
 * Messages are worded for BOTH modes — the default preview blocks these and
 * trusted preview runs them, so a message naming only the sandbox is wrong for
 * a document the user has authorized (#1273). They are also FALLBACKS: the
 * gutter prefers `diagnostic.<ruleId>` from the locale bundles, so any wording
 * change here has to be made there too or it is invisible.
 */
const HTML_RULES: readonly { ruleId: string; pattern: RegExp; message: string }[] = [
  {
    ruleId: "html/script-blocked",
    pattern: /<script\b/gi,
    message: "Script tag detected — blocked unless trusted preview is enabled.",
  },
  {
    ruleId: "html/javascript-url",
    // `[\s\S]` rather than `\s`: the whitespace between an attribute name and
    // its value may include newlines, and a line-at-a-time scan missed those.
    pattern: /\b(?:href|src)[\s]*=[\s]*["']?[\s]*javascript:/gi,
    message:
      "javascript: URL detected — blocked unless trusted preview is enabled.",
  },
  {
    ruleId: "html/inline-handler",
    pattern: /\son[a-z]+[\s]*=/gi,
    message:
      "Inline event handler detected — blocked unless trusted preview is enabled.",
  },
];

/**
 * Offset → 1-based line/column, over the whole source.
 *
 * The validator scans the complete document rather than line by line, because
 * splitting first defeats every pattern that may span a newline and forces
 * every column to be reported as 1. Line starts are computed once and binary
 * searched, so the scan stays linear in the document rather than quadratic.
 */
function positionResolver(content: string) {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lineStarts.push(i + 1);
  }
  return (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
  };
}

export const htmlValidator: Validator = (content) => {
  if (content.length === 0) return [];
  const at = positionResolver(content);
  const out: (ValidationDiagnostic & { offset: number })[] = [];

  for (const rule of HTML_RULES) {
    // Fresh regex per scan: a module-level /g/ carries `lastIndex` between
    // calls, so a shared one would skip matches on every second document.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (let m = pattern.exec(content); m !== null; m = pattern.exec(content)) {
      const { line, column } = at(m.index);
      out.push({
        severity: "warning",
        line,
        column,
        message: rule.message,
        ruleId: rule.ruleId,
        offset: m.index,
      });
      // A zero-length match would spin forever; none of the rules can produce
      // one, but the guard costs nothing and the failure mode is a hang.
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }

  // Document order, so the gutter reads top to bottom rather than grouped by
  // whichever rule happened to be listed first.
  out.sort((a, b) => a.offset - b.offset);
  return out.map(({ offset: _offset, ...diagnostic }) => diagnostic);
};

export const htmlFormat: FormatConfig = {
  id: "html",
  nameI18nKey: "format.html",
  extensions: ["html", "htm"],
  kind: "split-pane",
  loadLanguage: async (): Promise<Extension> => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  validator: htmlValidator,
  genericPreview: HtmlPreview,
  adapters: {
    saveDialogFilters: [{ nameI18nKey: "format.html", extensions: ["html", "htm"] }],
    untitledExtension: "html",
    exportEnabled: false,
    findEnabled: true,
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
    closeSavePolicy: "prompt-on-close",
  },
};

export function registerHtmlFormat(): void {
  registerFormat(htmlFormat);
}
