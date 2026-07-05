/**
 * Direct unit tests for stripInteractiveRules — the hand-rolled CSS rule
 * filter on the export path. Documents its behavioral contract: which rule
 * blocks survive into the export bundle and which are stripped.
 */
import { describe, it, expect } from "vitest";
import { stripInteractiveRules, getEditorCSSBundle } from "../editorCSSBundle";

describe("stripInteractiveRules", () => {
  it("keeps plain content rules untouched", () => {
    const css = [
      "h1 {",
      "  font-size: 2em;",
      "}",
      "p { margin: 1em 0; }",
    ].join("\n");
    expect(stripInteractiveRules(css)).toBe(css);
  });

  it("strips rules whose selector starts with an interactive prefix", () => {
    const css = [
      ".editor-container {",
      "  height: 100%;",
      "}",
      "h2 { color: black; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain(".editor-container");
    expect(out).not.toContain("height: 100%");
    expect(out).toContain("h2 { color: black; }");
  });

  it("strips :hover and :focus-visible rules", () => {
    const css = [
      "a:hover {",
      "  text-decoration: underline;",
      "}",
      "button:focus-visible {",
      "  outline: 2px solid blue;",
      "}",
      "a { color: blue; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain(":hover");
    expect(out).not.toContain(":focus-visible");
    expect(out).toContain("a { color: blue; }");
  });

  it("strips a whole comma selector group when ANY member is interactive", () => {
    // Documented behavior: a token match anywhere in the selector text (at a
    // class boundary) drops the entire group — the line-based parser cannot
    // split a comma group, so `.kept, .resize-handle` is stripped whole.
    const css = [
      ".kept, .resize-handle {",
      "  border: 1px solid red;",
      "}",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("border: 1px solid red");
  });

  it("keeps comma selector groups with no interactive member", () => {
    const css = [
      "h1, h2, h3 {",
      "  font-weight: bold;",
      "}",
    ].join("\n");
    expect(stripInteractiveRules(css)).toContain("font-weight: bold");
  });

  it("keeps @media print blocks including their nested rules", () => {
    const css = [
      "@media print {",
      "  .alert-note .alert-title::before {",
      "    background-image: url(\"data:image/svg+xml,%3Csvg%3E\");",
      "  }",
      "}",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).toContain("@media print {");
    expect(out).toContain("background-image: url(");
  });

  it("does not re-evaluate nested selectors inside a kept @media block", () => {
    // Depth tracking only classifies TOP-LEVEL blocks; a nested `.editor-content`
    // inside a kept @media survives. Documents current (lenient) behavior.
    const css = [
      "@media print {",
      "  .editor-content { padding: 0; }",
      "}",
    ].join("\n");
    expect(stripInteractiveRules(css)).toContain("padding: 0");
  });

  it("strips @keyframes blocks entirely, including multi-line bodies", () => {
    const css = [
      "@keyframes spin {",
      "  from { transform: rotate(0deg); }",
      "  to { transform: rotate(360deg); }",
      "}",
      "div { color: red; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("@keyframes");
    expect(out).not.toContain("rotate(360deg)");
    expect(out).toContain("div { color: red; }");
  });

  it("strips @media (prefers-reduced-motion) blocks with nested rules", () => {
    const css = [
      "@media (prefers-reduced-motion: reduce) {",
      "  * {",
      "    animation: none;",
      "  }",
      "}",
      "span { color: green; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("prefers-reduced-motion");
    expect(out).not.toContain("animation: none");
    expect(out).toContain("span { color: green; }");
  });

  it("preserves url(...) values containing encoded braces and quotes", () => {
    const url =
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 8a8'/%3E%3C/svg%3E\")";
    const css = [
      ".alert-tip .alert-title::before {",
      `  background-image: ${url};`,
      "}",
    ].join("\n");
    expect(stripInteractiveRules(css)).toContain(url);
  });

  it("handles single-line rules with open AND close brace on one line", () => {
    const css = [
      ".resize-handle { width: 4px; }",
      ".content { width: 100%; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("width: 4px");
    expect(out).toContain(".content { width: 100%; }");
  });

  it("resets skip state after a stripped single-line rule (next rule kept)", () => {
    const css = [
      ".table-ui { display: flex; }",
      ".after { display: block; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("display: flex");
    expect(out).toContain(".after { display: block; }");
  });

  it("handles nested braces on one line inside a stripped block", () => {
    // A stripped block whose inner line opens and closes a nested block on
    // one line must not desync the depth counter.
    const css = [
      "@keyframes pulse {",
      "  0% { opacity: 0; } 100% { opacity: 1; }",
      "}",
      ".next { color: blue; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("opacity: 0");
    expect(out).toContain(".next { color: blue; }");
  });

  it("removes @import statements", () => {
    const css = [
      '@import "./mermaid-fallback.css";',
      ".diagram { display: block; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("@import");
    expect(out).toContain(".diagram { display: block; }");
  });

  it("strips ProseMirror interactive-state rules", () => {
    const css = [
      ".ProseMirror-gapcursor { display: none; }",
      ".ProseMirror-selectednode { outline: 2px solid; }",
      ".ProseMirror p { margin: 0; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("gapcursor");
    expect(out).not.toContain("selectednode");
    expect(out).toContain(".ProseMirror p { margin: 0; }");
  });

  it("returns empty output for empty input", () => {
    expect(stripInteractiveRules("")).toBe("");
  });

  // --- Comment/string brace handling (Codex audit: raw-line brace counting
  // desyncs on braces inside comments or strings) ---

  it("ignores braces inside a single-line comment (depth stays in sync)", () => {
    // The `{` in the comment must not open a phantom block — otherwise the
    // following .resize-handle rule is mis-read as nested and survives.
    const css = [
      "/* tip: use { sparingly */",
      ".resize-handle { width: 4px; }",
      ".keep { color: red; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("width: 4px");
    expect(out).toContain(".keep { color: red; }");
  });

  it("ignores braces inside a multi-line comment", () => {
    const css = [
      "/*",
      " .editor-content { padding: 0; }",
      "*/",
      "h1 { color: red; }",
      ".table-ui { display: flex; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).toContain("h1 { color: red; }");
    expect(out).not.toContain("display: flex");
  });

  it("ignores braces inside string values (content: \"{\")", () => {
    const css = [
      '.foo::before { content: "{"; }',
      ".resize-handle { width: 4px; }",
      ".bar { color: blue; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).toContain('content: "{"');
    expect(out).not.toContain("width: 4px");
    expect(out).toContain(".bar { color: blue; }");
  });

  it("ignores braces inside single-quoted strings", () => {
    const css = [
      ".foo::after { content: '}'; }",
      ".table-ui { display: flex; }",
      ".baz { color: green; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).toContain("content: '}'");
    expect(out).not.toContain("display: flex");
    expect(out).toContain(".baz { color: green; }");
  });

  it("keeps nested at-rules intact inside a kept block", () => {
    const css = [
      "@media print {",
      "  @supports (display: grid) {",
      "    .grid { display: grid; }",
      "  }",
      "}",
      ".after { color: black; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).toContain("@supports (display: grid)");
    expect(out).toContain("display: grid;");
    expect(out).toContain(".after { color: black; }");
  });

  // --- Class-boundary matching (Codex audit: bare substring includes()
  // stripped unrelated selectors that merely CONTAIN a token) ---

  it("keeps a selector whose class merely contains a token as substring", () => {
    // `.editor-contents` is a different class than `.editor-content` — the
    // letter continuation breaks the class-name boundary.
    const css = [
      ".editor-contents { margin: 0; }",
      ".my-table-uid { padding: 0; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).toContain(".editor-contents { margin: 0; }");
    expect(out).toContain(".my-table-uid { padding: 0; }");
  });

  it("still strips hyphen-extended family classes (current-strip contract)", () => {
    // Real input relies on this: .code-block-live-preview-empty/-error are
    // stripped today via the .code-block-live-preview token and must stay so.
    const css = [
      ".code-block-live-preview-error { color: red; }",
      ".code-block-live-preview-empty { opacity: 0.5; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("color: red");
    expect(out).not.toContain("opacity: 0.5");
  });

  it("still strips tokens matched mid-selector (descendant/compound positions)", () => {
    // Real inputs rely on non-prefix matches: `.dark-theme .code-lang-dropdown`
    // and compound `.math-inline.ProseMirror-selectednode`.
    const css = [
      ".dark-theme .code-lang-dropdown { background: black; }",
      ".math-inline.ProseMirror-selectednode { outline: 1px solid; }",
    ].join("\n");
    const out = stripInteractiveRules(css);
    expect(out).not.toContain("background: black");
    expect(out).not.toContain("outline: 1px solid");
  });

  it("keeps pseudo-class-free selectors containing 'hover' as plain text", () => {
    const css = ".my-hovercard { border: 1px solid; }";
    expect(stripInteractiveRules(css)).toContain(".my-hovercard");
  });
});

describe("getEditorCSSBundle", () => {
  it("returns a string and caches the result", () => {
    // NOTE: under vitest, ?raw CSS imports resolve to empty strings, so the
    // bundle content itself can't be asserted here — real-content behavior is
    // covered by running stripInteractiveRules over the on-disk CSS below.
    const first = getEditorCSSBundle();
    expect(typeof first).toBe("string");
    expect(getEditorCSSBundle()).toBe(first);
  });
});

describe("bundle pipeline over real alert-block.css", () => {
  it("keeps the @media print alert SVG fallbacks (single source of truth)", async () => {
    // The bundle carries alert-block.css's @media print icon fallbacks into
    // the export; exportOverrides must NOT duplicate them (see
    // htmlExportStylesContent.test.ts). ?raw imports are empty under vitest,
    // so run the same filter over the real file read from disk.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const alertCss = readFileSync(
      resolve(__dirname, "../../plugins/alertBlock/alert-block.css"),
      "utf8",
    );
    const out = stripInteractiveRules(alertCss);
    expect(out).toContain("@media print");
    expect(out).toMatch(
      /\.alert-note \.alert-title::before[^}]*background-image: url\(/s,
    );
    expect(out).toMatch(
      /\.alert-caution \.alert-title::before[^}]*background-image: url\(/s,
    );
  });
});
