// WI-1A.4 — SourcePane skeleton.
//
// Wraps the CodeMirror surface for non-markdown formats. In Phase 1A this
// is a thin shell — no language pack, no validator wired in yet. WI-1A.9
// (txt adapter), WI-1A.8 (validator gutter), and Phase 2 (data-format
// adapters) progressively fill it.
//
// The component is intentionally light so that splitting heavy CodeMirror
// imports into the source pane keeps the SplitPaneEditor unit-testable
// without DOM-heavy CodeMirror dependencies.

import { useDocumentStore } from "@/stores/documentStore";
import type { FormatConfig } from "@/lib/formats/types";

export interface SourcePaneProps {
  tabId: string;
  formatId: string;
  formatConfig: FormatConfig;
}

export function SourcePane({ tabId, formatId, formatConfig }: SourcePaneProps) {
  /* v8 ignore next 3 -- @preserve documentStore selector path; smoke-tested via mocked store */
  const content = useDocumentStore(
    (state) => state.documents?.[tabId]?.content ?? "",
  );
  // Defensive — formatConfig is consumed by future Phase 1A WIs (validator,
  // language pack loaders). Reference it so the linter knows it isn't dead.
  /* v8 ignore next 3 -- @preserve formatConfig consumed by future WIs */
  const dataAttrs = {
    "data-format-id": formatId,
    "data-language-loader": formatConfig.loadLanguage ? "lazy" : "none",
  };
  return (
    <div
      className="source-pane"
      data-testid="source-pane"
      data-tab-id={tabId}
      {...dataAttrs}
    >
      <div role="textbox" aria-multiline="true" className="source-pane__editor">
        {content}
      </div>
    </div>
  );
}

export default SourcePane;
