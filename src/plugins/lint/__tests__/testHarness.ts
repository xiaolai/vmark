/**
 * Shared scaffolding for the lint-extension tests.
 *
 * Extracted so `../tiptap.test.ts` and `../tiptapDecorations.test.ts` build the same
 * schema, documents and diagnostics — two copies would drift, and the
 * decoration assertions only mean anything if both files lint the same shapes.
 *
 * `getPlugins` passes the REAL host adapter rather than a stub: these tests
 * drive the actual stores, so they must exercise the wiring the app ships.
 *
 * @module plugins/lint/__tests__/testHarness
 */

import { Schema } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useSettingsStore } from "@/stores/settingsStore";
import type { LintDiagnostic } from "@/lib/lintEngine/types";
import { LintExtension } from "../tiptap";
import { lintDiagnosticsSource } from "@/services/assembly/hostAdapters";

/** Flip the markdown.lintEnabled setting in the real settings store. */
export function setLintEnabled(enabled: boolean) {
  useSettingsStore.setState((s) => ({
    markdown: { ...s.markdown, lintEnabled: enabled },
  }));
}

// Helpers
// ---------------------------------------------------------------------------

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
    codeBlock: {
      group: "block",
      content: "text*",
      code: true,
    },
    text: { group: "inline" },
  },
  marks: {},
});

export function makePara(text: string): PMNode {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

export function makeHeading(text: string, level = 1): PMNode {
  return schema.node("heading", { level }, text ? [schema.text(text)] : []);
}

export function makeCode(text: string): PMNode {
  return schema.node("codeBlock", null, text ? [schema.text(text)] : []);
}

export function makeDoc(...blocks: PMNode[]): PMNode {
  return schema.node("doc", null, blocks);
}

export function makeDiagnostic(overrides: Partial<LintDiagnostic> = {}): LintDiagnostic {
  return {
    id: "E01-1-1",
    ruleId: "E01",
    severity: "warning",
    messageKey: "lint.E01",
    messageParams: {},
    line: 1,
    column: 1,
    offset: 0,
    uiHint: "block",
    ...overrides,
  };
}

/** Invoke addProseMirrorPlugins on the LintExtension with a given tabId. */
export function getPlugins(tabId: string) {
  return LintExtension.config.addProseMirrorPlugins!.call({
    name: "markdownLint",
    options: { tabId, diagnostics: lintDiagnosticsSource },
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  });
}
