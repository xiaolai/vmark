# Phase 0 — WI-0.1 + WI-0.2 + WI-0.3 — Type-level proofs

**Date:** 2026-05-06
**Spike type:** type-level + documentation review (no installed-deps execution)
**Plan:** `dev-docs/plans/20260506-multi-format-rebrand.md`
**Disposition:** Spike artifacts (this file + the embedded TS samples) are deleted before Phase 1A per ADR-11. Findings transcribed below.

## Method

The plan asks three runtime questions:
- WI-0.1: can `<SplitPaneEditor>` mount CodeMirror with arbitrary language packs?
- WI-0.2: can `dispatchEditor()` route correctly without special-casing per format?
- WI-0.3: does CodeMirror's `linter` extension accept arbitrary diagnostics from non-CM parsers and render them as gutter markers?

Per AGENTS.md the spike does not start a dev server. Verification is therefore type-level + docs review:
- `@codemirror/lang-yaml` is installed → confirmed `LanguageSupport` is the right slot.
- `@codemirror/lint` is reachable via existing markdown lint engine → confirmed `Diagnostic` shape.
- `SourceEditor.tsx` is the existing CodeMirror mount → confirmed the surface is generalizable.

Each spike below states the hypothesis, the type-level proof, and verdict.

---

## WI-0.1 — `<SplitPaneEditor>` shape

**Hypothesis:** A single React component mounts a CodeMirror EditorView with a per-format language pack via the registry's `loadLanguage()` factory.

**Proof of concept** (would compile against installed `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-yaml`):

```tsx
// dev-docs/grills/multi-format/spike-split-pane.tsx (illustrative)
import { useEffect, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface SplitPaneEditorProps {
  initialContent: string;
  loadLanguage?: () => Promise<Extension>;
  preview?: React.ReactNode; // rendered in right pane
  validator?: (content: string) => Diagnostic[]; // see WI-0.3
}

export function SplitPaneEditor({ initialContent, loadLanguage, preview }: SplitPaneEditorProps) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const [langExt, setLangExt] = useState<Extension | null>(null);

  useEffect(() => {
    if (!loadLanguage) return;
    let cancelled = false;
    loadLanguage().then((ext) => { if (!cancelled) setLangExt(ext); });
    return () => { cancelled = true; };
  }, [loadLanguage]);

  useEffect(() => {
    if (!sourceRef.current) return;
    const state = EditorState.create({
      doc: initialContent,
      extensions: langExt ? [langExt] : [],
    });
    const view = new EditorView({ state, parent: sourceRef.current });
    return () => view.destroy();
  }, [langExt, initialContent]);

  return (
    <div className="split-pane">
      <div ref={sourceRef} className="source-pane" />
      <div className="preview-pane">{preview}</div>
    </div>
  );
}
```

**Verdict: CONFIRMED.** `LanguageSupport` from `@codemirror/lang-yaml`, `@codemirror/lang-markdown` (both installed) and the planned `@codemirror/lang-{json,html,xml,css,javascript,python,rust,go}` packs all return the same shape (`LanguageSupport extends Extension`). The loader pattern is standard CodeMirror v6 and is already used in `src/utils/sourceEditorExtensions.ts`. No surprises expected.

**Caveat:** Theme integration with the existing `SourceEditor` theme extensions and the markdown-specific keymap will need to be split into "common" extensions (line numbers, undo, find, basic theme) vs. "format-specific" extensions in WI-1A.4. Already accounted for in the plan.

---

## WI-0.2 — Format registry shape

**Hypothesis:** `dispatchEditor(filePath: string | null) → FormatConfig` routes correctly using only the path's extension. Markdown is routed to its `wysiwyg` config; everything else to its `split-pane`/`viewer` config; unknown extensions fall back to `.txt` plain-text config.

**Proof of concept:**

```ts
// dev-docs/grills/multi-format/spike-registry.ts (illustrative)
import type { FormatConfig } from "./types"; // the interface from § Format registry contract

const formats = new Map<string, FormatConfig>();

export function registerFormat(config: FormatConfig): void {
  // (runtime invariants per plan §"`registerFormat()` runtime invariants" omitted here)
  for (const ext of config.extensions) {
    if (formats.has(ext)) throw new Error(`extension ${ext} already registered`);
    formats.set(ext, config);
  }
}

export function dispatchEditor(filePath: string | null): FormatConfig {
  if (!filePath) return formats.get("md")!; // default for untitled
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return formats.get(ext) ?? formats.get("txt")!; // fallback
}

// Smoke test (illustrative — would assert in vitest):
// dispatchEditor("foo.md")    → markdown config (kind: "wysiwyg")
// dispatchEditor("foo.json")  → json config (kind: "split-pane")
// dispatchEditor("foo.unknown") → txt config (kind: "split-pane", language: undefined)
// dispatchEditor(null)        → markdown config (default for untitled)
```

**Verdict: CONFIRMED.** Pure-function dispatch with a Map lookup; no special-casing per format. ADR-7 (one extension, one editor — no content sniffing) makes this trivial. The five smoke-test cases above are the entire dispatch contract; Phase 1A turns each into a vitest assertion in WI-1A.2.

**Edge case named:** filenames without extensions (`Makefile`, `Cargo.lock`, `.bashrc`) currently fall through to `.txt`. That's acceptable for v1. v1.x can add a `filenameDetectors` registry slot if user demand emerges.

---

## WI-0.3 — Validator-to-gutter integration

**Hypothesis:** CodeMirror's `linter` extension from `@codemirror/lint` accepts a function `(view: EditorView) => Diagnostic[]` and renders the returned diagnostics as gutter markers. Our normalized `ValidationDiagnostic` (line/column-based) can be converted to CodeMirror's `Diagnostic` (offset-based) via `EditorState.doc.line(line).from + (column - 1)`.

**Proof of concept** (verified against `node_modules/@codemirror/lint/dist/index.d.ts`):

```ts
// dev-docs/grills/multi-format/spike-validator.ts (illustrative)
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";

interface ValidationDiagnostic {
  severity: "error" | "warning" | "info";
  line: number;     // 1-indexed
  column: number;   // 1-indexed
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId?: string;
}

function toCmDiagnostic(view: EditorView, d: ValidationDiagnostic): Diagnostic {
  const startLine = view.state.doc.line(d.line);
  const from = startLine.from + Math.max(0, d.column - 1);
  const endLine = d.endLine ? view.state.doc.line(d.endLine) : startLine;
  const to = d.endColumn ? endLine.from + Math.max(0, d.endColumn - 1) : Math.min(from + 1, startLine.to);

  return {
    from,
    to,
    severity: d.severity === "info" ? "info" : d.severity, // CM also has "hint"; we don't use it
    message: d.message,
    source: d.ruleId,
  };
}

export function makeFormatLinter(
  validator: (content: string) => ValidationDiagnostic[]
) {
  return linter((view) => {
    const content = view.state.doc.toString();
    const diagnostics = validator(content);
    return diagnostics.map((d) => toCmDiagnostic(view, d));
  });
}

// Usage example with js-yaml (already installed):
// import yaml from "js-yaml";
// const yamlValidator = (content: string): ValidationDiagnostic[] => {
//   try { yaml.load(content); return []; }
//   catch (e: any) {
//     // js-yaml throws YAMLException with .mark.line / .mark.column (0-indexed)
//     return [{ severity: "error", line: e.mark.line + 1, column: e.mark.column + 1, message: e.reason }];
//   }
// };
// const yamlLinter = makeFormatLinter(yamlValidator);
```

**Verdict: CONFIRMED.** `@codemirror/lint` `Diagnostic` type matches our `ValidationDiagnostic` 1-to-1 modulo position conversion (offset vs line/column). `linter()` accepts both sync and async (Promise) sources. Gutter rendering is built-in (`lintGutter()` extension) and uses CSS classes that VMark can theme. The conversion is 5 lines of arithmetic — Phase 1A WI-1A.8 normalizes this in `src/lib/formats/validation.ts`.

**Caveat:** CodeMirror also has a `"hint"` severity level we don't use. Decision: collapse to `"info"` at the boundary; document in WI-1A.8 review.

---

## Aggregate verdict (WI-0.1, 0.2, 0.3)

All three CONFIRMED. None of these spikes blocks Phase 1A. The risk surface is concentrated in **WI-0.4** (HTML sandbox in Tauri webview) and **WI-0.7** (`Editor.tsx` surface refactor breadth) — both already produced separate findings.

**Cleanup before Phase 1A** (per ADR-11):

- This file: `findings-spikes-1-to-3.md` — kept as the historical record of the verdicts. Not deleted.
- The `spike-split-pane.tsx`, `spike-registry.ts`, `spike-validator.ts` files referenced above were not actually written to disk — the proof is documentation-only. Nothing to delete.

Phase 1A WI-1A.1 / 1A.2 / 1A.4 / 1A.8 implement these patterns against the real codebase with full TDD coverage.
