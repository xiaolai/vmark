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

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Extension } from "@codemirror/state";
import DOMPurify from "dompurify";
import { registerFormat } from "../registry";
import type {
  FormatConfig,
  PreviewRendererProps,
  ValidationDiagnostic,
  Validator,
} from "../types";

const SCRIPT_TAG_RE = /<script\b/i;
const JS_URL_RE = /\b(href|src)\s*=\s*["']?\s*javascript:/i;
const INLINE_HANDLER_RE = /\son[a-z]+\s*=/i;

export const htmlValidator: Validator = (content) => {
  if (content.length === 0) return [];
  const out: ValidationDiagnostic[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SCRIPT_TAG_RE.test(line)) {
      out.push({
        severity: "warning",
        line: i + 1,
        column: 1,
        message:
          "Script tag detected — sandboxed preview will block execution.",
        ruleId: "html/script-blocked",
      });
    }
    if (JS_URL_RE.test(line)) {
      out.push({
        severity: "warning",
        line: i + 1,
        column: 1,
        message: "javascript: URL detected — sandboxed preview will block.",
        ruleId: "html/javascript-url",
      });
    }
    if (INLINE_HANDLER_RE.test(line)) {
      out.push({
        severity: "warning",
        line: i + 1,
        column: 1,
        message: "Inline event handler detected — sandboxed preview will block.",
        ruleId: "html/inline-handler",
      });
    }
  }
  return out;
};

const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:; base-uri \'none\';">';

function buildSandboxedSrcdoc(content: string): string {
  // DOMPurify defense-in-depth — strips script tags, javascript:
  // URLs, inline event handlers, etc. before the iframe renders.
  // The empty sandbox is the second line of defense; CSP <meta>
  // restricts resource loading inside the iframe (third line).
  const sanitized = DOMPurify.sanitize(content, {
    WHOLE_DOCUMENT: true,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#|data:image\/):|[^a-z]|$)/i,
  });
  // If sanitization stripped <head> or doctype, re-inject the CSP
  // meta inside any <head> we can find; otherwise prepend it.
  if (/<head[\s>]/i.test(sanitized)) {
    return sanitized.replace(/<head([\s>])/i, `<head$1${CSP_META}`);
  }
  return `<!doctype html><html><head>${CSP_META}</head><body>${sanitized}</body></html>`;
}

function HtmlSandboxPreview({ content, diagnostics }: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  // React updates the iframe's srcDoc prop on every change — no
  // imperative ref+effect duplicate needed. SplitPaneEditor re-renders
  // on every keystroke, so the iframe rebuilds at typing rhythm. If
  // perf becomes an issue, debounce `content` upstream rather than
  // double-writing here.
  const srcdoc = useMemo(() => buildSandboxedSrcdoc(content), [content]);

  if (!content.trim()) {
    return <div className="html-preview html-preview--empty" />;
  }

  return (
    <div className="html-preview">
      {/* Phase 3 ships the HTML adapter with iframe-sandbox +
          DOMPurify defense-in-depth. The OWASP top-20 verification
          (WI-3.4) is interactive and gates Phase 3 readiness for
          rebrand. Surface the pending state so users know the
          preview hasn't been signed off yet. */}
      <div
        className="html-preview__sign-off-pending"
        role="status"
        data-testid="html-preview-sign-off-pending"
      >
        {t("preview.signOffPending")}
      </div>
      {diagnostics.length > 0 && (
        <div className="html-preview__hint" role="status">
          {t("preview.errorAt", {
            line: diagnostics[0].line,
            column: diagnostics[0].column,
          })}
        </div>
      )}
      <iframe
        // Empty sandbox: no scripts, no same-origin, no forms, no popups.
        sandbox=""
        title={t("preview.htmlIframeTitle")}
        srcDoc={srcdoc}
        className="html-preview__iframe"
        // referrerPolicy is honored by the outer document; the iframe
        // can't make network requests anyway because of the empty
        // sandbox + CSP default-src 'none'.
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

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
  genericPreview: HtmlSandboxPreview,
  adapters: {
    saveDialogFilters: [{ name: "HTML", extensions: ["html", "htm"] }],
    untitledExtension: "html",
    exportEnabled: false,
    findEnabled: true,
    searchAdapter: "codemirror",
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
    closeSavePolicy: "markdown-default",
  },
};

export function registerHtmlFormat(): void {
  registerFormat(htmlFormat);
}
