/**
 * Purpose: Modal CodeMirror editor for expression-heavy fields in the
 *   structured workflow editor — `if:` (GitHub Actions expression),
 *   `run:` (shell), and any future text-heavy field. The plan's Phase 7
 *   spec calls for a "small CodeMirror editor that pops" so users can
 *   work on long expressions with proper monospace, line numbers, and
 *   newline support without fighting with a single-line input.
 *
 *   Save commits via the parent-supplied callback (typically the same
 *   handler used by the inline textarea's onBlur). Cancel discards.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 7 / WI-7.1 + Phase 9 finish.
 *
 * Key decisions:
 *   - Plain CodeMirror — no language extension yet for `run:` since
 *     adding @codemirror/lang-shell would expand the bundle. `if:` uses
 *     yaml's existing lang setup since expressions live inline in YAML.
 *   - Modal renders as a fixed-position overlay; closes on Escape and
 *     on backdrop click. Focus moves into the editor on mount.
 *
 * @coordinates-with src/components/Editor/WorkflowEditor/StepForm.tsx —
 *   the consumer that surfaces the "expand" button next to `if:` / `run:`.
 * @module components/Editor/WorkflowEditor/ExpressionEditor
 */

import { useEffect, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import "./workflow-editor.css";

interface ExpressionEditorProps {
  /** The current value to seed the editor with. */
  initialValue: string;
  /** "yaml" applies the existing YAML extension; "plain" is text-only. */
  language: "yaml" | "plain";
  /** Title shown in the modal header (e.g., "Edit run:"). */
  title: string;
  /** Called with the final value when the user saves. */
  onSave: (value: string) => void;
  /** Called when the user cancels (Escape, backdrop click, Cancel button). */
  onCancel: () => void;
}

export function ExpressionEditor({
  initialValue,
  language,
  title,
  onSave,
  onCancel,
}: ExpressionEditorProps): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Capture initialValue + language as refs so the mount effect doesn't
  // depend on them and rebuild the editor on parent re-renders. Without
  // this, every re-render of the parent (e.g., when the form's blur
  // commits a patch and the workflowEditStore notifies subscribers)
  // tore down the CodeMirror instance, losing cursor position and undo
  // history (cross-validator audit finding).
  const initialValueRef = useRef(initialValue);
  const languageRef = useRef(language);

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions = [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
    ];
    if (languageRef.current === "yaml") extensions.push(yaml());
    const view = new EditorView({
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions,
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount-once: deliberately exclude initialValue + language so the
    // editor is not rebuilt on prop reference churn. The modal lifecycle
    // (open → edit → save/cancel → unmount) means a new modal mount
    // means a new component instance, which is the correct re-init
    // signal.
     
  }, []);

  const handleSave = (): void => {
    const view = viewRef.current;
    onSave(view ? view.state.doc.toString() : initialValue);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    // Cmd+Enter / Ctrl+Enter saves
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div
      className="workflow-expression-editor__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="workflow-expression-editor">
        <header className="workflow-expression-editor__header">
          <span className="workflow-expression-editor__title">{title}</span>
        </header>
        <div className="workflow-expression-editor__host" ref={hostRef} />
        <footer className="workflow-expression-editor__footer">
          <button
            type="button"
            className="workflow-editor-panel__btn"
            onClick={onCancel}
          >
            {t("expression.cancel")}
          </button>
          <button
            type="button"
            className="workflow-editor-panel__btn workflow-editor-panel__btn--primary"
            onClick={handleSave}
          >
            {t("expression.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
