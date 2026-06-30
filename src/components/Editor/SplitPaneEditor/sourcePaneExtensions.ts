/**
 * sourcePaneExtensions
 *
 * Purpose: Pure builders for SourcePane's CodeMirror wiring — the lint
 * extension (format.validator → gutter + hoisted diagnostics), the base
 * extension list, and the diagnostic-to-CodeMirror mapping. Extracted from
 * SourcePane so its mount effect is a thin assembler. No React, no DOM —
 * unit-testable in isolation.
 *
 * @coordinates-with SourcePane.tsx — sole caller
 * @coordinates-with lib/formats/types — FormatConfig.validator contract
 * @module components/Editor/SplitPaneEditor/sourcePaneExtensions
 */
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { linter, type Diagnostic } from "@codemirror/lint";
import { syntaxHighlighting } from "@codemirror/language";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { sourceEditorTheme, codeHighlightStyle } from "@/plugins/codemirror/theme";
import type { FormatConfig, ValidationDiagnostic } from "@/lib/formats/types";

/** Map a format ValidationDiagnostic to a CodeMirror Diagnostic, clamping
 *  line/column to the doc's real range so an out-of-range report can't throw
 *  inside doc.line() and break linting. */
export function diagnosticToCodemirror(
  doc: {
    line: (n: number) => { from: number; to: number; length: number };
    lines: number;
  },
  d: ValidationDiagnostic,
): Diagnostic {
  const totalLines = Math.max(1, doc.lines);
  const startLine = Math.min(Math.max(1, d.line), totalLines);
  const lineInfo = doc.line(startLine);
  const from = Math.min(lineInfo.from + Math.max(0, d.column - 1), lineInfo.to);
  let to: number;
  if (d.endLine !== undefined && d.endColumn !== undefined) {
    const endLine = Math.min(Math.max(1, d.endLine), totalLines);
    const endLineInfo = doc.line(endLine);
    to = Math.min(endLineInfo.from + Math.max(0, d.endColumn - 1), endLineInfo.to);
  } else {
    to = Math.min(from + 1, lineInfo.to);
  }
  return {
    from,
    to: to <= from ? Math.min(from + 1, lineInfo.to) : to,
    severity: d.severity,
    message: d.message,
    source: d.ruleId,
  };
}

/** Build the validator-backed lint extension, or null when the format has no
 *  validator. Hoists diagnostics to `onDiagnostics` for the preview pane. */
export function buildValidationLinter(
  tabId: string,
  validator: FormatConfig["validator"],
  onDiagnostics: (diagnostics: ValidationDiagnostic[]) => void,
): Extension | null {
  if (!validator) return null;
  return linter((view) => {
    const text = view.state.doc.toString();
    const path = useDocumentStore.getState().documents?.[tabId]?.filePath ?? undefined;
    const diagnostics = validator(text, path ?? undefined);
    onDiagnostics(diagnostics);
    return diagnostics.map((d) => diagnosticToCodemirror(view.state.doc, d));
  });
}

export interface BuildExtensionsArgs {
  tabId: string;
  readOnly: boolean;
  validator: FormatConfig["validator"];
  /** Compartment owning the line-number gutter (toggled in place). */
  lineNumberCompartment: Compartment;
  /** Compartment owning line wrapping (toggled by the Word Wrap setting). */
  lineWrapCompartment: Compartment;
  /** Compartment owning the lazily-loaded language pack. */
  languageCompartment: Compartment;
  /** Persist-on-change listener (writes documentStore.setContent). */
  persistOnUpdate: Extension;
  /** Hoists lint diagnostics to the preview pane. */
  onDiagnostics: (diagnostics: ValidationDiagnostic[]) => void;
}

/** Assemble the full base extension list for the SourcePane editor. */
export function buildSourcePaneExtensions(args: BuildExtensionsArgs): Extension[] {
  const {
    tabId,
    readOnly,
    validator,
    lineNumberCompartment,
    lineWrapCompartment,
    languageCompartment,
    persistOnUpdate,
    onDiagnostics,
  } = args;

  const extensions: Extension[] = [
    // Gutter is compartmentalized so the line-numbers toggle reconfigures it
    // without remounting. Initial state read from the store at mount.
    lineNumberCompartment.of(
      useUIStore.getState().showLineNumbers ? lineNumbers() : [],
    ),
    history(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    // Line wrapping is compartmentalized so the Word Wrap toggle
    // (uiStore.wordWrap) reconfigures it in place. Previously hardcoded on,
    // which silently ignored the toggle in Split View (#1070).
    lineWrapCompartment.of(
      useUIStore.getState().wordWrap ? EditorView.lineWrapping : [],
    ),
    // Same caret/selection/mono-font theme + GitHub syntax palette the
    // markdown Source editor uses; fallback:true colors tokens before a
    // language pack resolves.
    syntaxHighlighting(codeHighlightStyle, { fallback: true }),
    sourceEditorTheme,
    // Empty initial language — the loadLanguage promise reconfigures this.
    languageCompartment.of([]),
    persistOnUpdate,
  ];

  const validationLinter = buildValidationLinter(tabId, validator, onDiagnostics);
  if (validationLinter) extensions.push(validationLinter);
  if (readOnly) extensions.push(EditorState.readOnly.of(true));

  return extensions;
}
