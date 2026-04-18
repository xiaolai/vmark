/**
 * Smoke tests for category sub-dispatchers.
 *
 * Each sub-dispatcher is a big switch. These tests verify:
 *   - it claims (returns `true`) for each type it advertises
 *   - it does NOT claim unrelated types (returns `false`)
 *   - dispatchers never overlap — a type owned by one MUST NOT be
 *     claimed by another
 *
 * This catches the "someone added a new handler and forgot the case"
 * class of bug and protects against route-table drift.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub every handler module before the dispatchers are imported.
// Each mocked handler resolves to undefined — dispatchers only need the
// import to succeed, we verify routing by which dispatcher returns true.

function resolveVoid() {
  return vi.fn().mockResolvedValue(undefined);
}

const handlerFactories: Record<string, () => Record<string, unknown>> = {
  documentHandlers: () => ({
    handleGetContent: resolveVoid(),
    handleDocumentSearch: resolveVoid(),
    handleOutlineGet: resolveVoid(),
    handleMetadataGet: resolveVoid(),
  }),
  selectionHandlers: () => ({
    handleSelectionGet: resolveVoid(),
    handleSelectionSet: resolveVoid(),
  }),
  suggestionHandlers: () => ({
    handleSetContent: resolveVoid(),
    handleInsertAtCursorWithSuggestion: resolveVoid(),
    handleInsertAtPositionWithSuggestion: resolveVoid(),
    handleDocumentReplaceInSourceWithSuggestion: resolveVoid(),
    handleSelectionReplaceWithSuggestion: resolveVoid(),
    handleSuggestionAccept: resolveVoid(),
    handleSuggestionReject: resolveVoid(),
    handleSuggestionList: resolveVoid(),
    handleSuggestionAcceptAll: resolveVoid(),
    handleSuggestionRejectAll: resolveVoid(),
  }),
  cursorHandlers: () => ({
    handleCursorGetContext: resolveVoid(),
    handleCursorSetPosition: resolveVoid(),
  }),
  formatHandlers: () => ({
    handleFormatToggle: resolveVoid(),
    handleFormatSetLink: resolveVoid(),
    handleFormatRemoveLink: resolveVoid(),
    handleFormatClear: resolveVoid(),
  }),
  editorHandlers: () => ({
    handleUndo: resolveVoid(),
    handleRedo: resolveVoid(),
    handleFocus: resolveVoid(),
    handleGetUndoState: resolveVoid(),
    handleSetMode: resolveVoid(),
  }),
  blockListHandlers: () => ({
    handleBlockSetType: resolveVoid(),
    handleListToggle: resolveVoid(),
    handleInsertHorizontalRule: resolveVoid(),
    handleListIncreaseIndent: resolveVoid(),
    handleListDecreaseIndent: resolveVoid(),
  }),
  tableHandlers: () => ({
    handleTableInsert: resolveVoid(),
    handleTableDelete: resolveVoid(),
  }),
  workspaceHandlers: () => ({
    handleWindowsList: resolveVoid(),
    handleWindowsGetFocused: resolveVoid(),
    handleWindowsFocus: resolveVoid(),
    handleWorkspaceNewDocument: resolveVoid(),
    handleWorkspaceOpenDocument: resolveVoid(),
    handleWorkspaceSaveDocument: resolveVoid(),
    handleWorkspaceSaveDocumentAs: resolveVoid(),
    handleWorkspaceGetDocumentInfo: resolveVoid(),
    handleWorkspaceCloseWindow: resolveVoid(),
    handleWorkspaceListRecentFiles: resolveVoid(),
    handleWorkspaceGetInfo: resolveVoid(),
    handleWorkspaceReloadDocument: resolveVoid(),
  }),
  tabHandlers: () => ({
    handleTabsList: resolveVoid(),
    handleTabsGetActive: resolveVoid(),
    handleTabsSwitch: resolveVoid(),
    handleTabsClose: resolveVoid(),
    handleTabsCreate: resolveVoid(),
    handleTabsGetInfo: resolveVoid(),
    handleTabsReopenClosed: resolveVoid(),
  }),
  genieHandlers: () => ({
    handleGeniesList: resolveVoid(),
    handleGeniesRead: resolveVoid(),
    handleGeniesInvoke: resolveVoid(),
  }),
  vmarkHandlers: () => ({
    handleInsertMathInline: resolveVoid(),
    handleInsertMathBlock: resolveVoid(),
    handleInsertMermaid: resolveVoid(),
    handleInsertMarkmap: resolveVoid(),
    handleInsertSvg: resolveVoid(),
    handleInsertWikiLink: resolveVoid(),
  }),
  cjkHandlers: () => ({
    handleCjkPunctuationConvert: resolveVoid(),
    handleCjkSpacingFix: resolveVoid(),
    handleCjkFormat: resolveVoid(),
  }),
  smartInsertHandlers: () => ({ handleSmartInsert: resolveVoid() }),
  mediaHandlers: () => ({ handleInsertMedia: resolveVoid() }),
  protocolHandlers: () => ({
    handleGetCapabilities: resolveVoid(),
    handleGetRevision: resolveVoid(),
  }),
  structureHandlers: () => ({
    handleGetAst: resolveVoid(),
    handleGetDigest: resolveVoid(),
    handleListBlocks: resolveVoid(),
    handleResolveTargets: resolveVoid(),
    handleGetSection: resolveVoid(),
  }),
  mutationHandlers: () => ({
    handleBatchEdit: resolveVoid(),
    handleApplyDiff: resolveVoid(),
    handleReplaceAnchored: resolveVoid(),
  }),
  sectionHandlers: () => ({
    handleSectionUpdate: resolveVoid(),
    handleSectionInsert: resolveVoid(),
    handleSectionMove: resolveVoid(),
  }),
  paragraphHandlers: () => ({
    handleParagraphRead: resolveVoid(),
    handleParagraphWrite: resolveVoid(),
  }),
  batchOpHandlers: () => ({
    handleTableBatchModify: resolveVoid(),
    handleListBatchModify: resolveVoid(),
  }),
};

for (const [name, factory] of Object.entries(handlerFactories)) {
  vi.mock(`../${name}`, () => factory());
}

// Imports after mocks
import { dispatchDocument } from "../dispatchers/documentDispatch";
import { dispatchEditor } from "../dispatchers/editorDispatch";
import { dispatchWorkspace } from "../dispatchers/workspaceDispatch";
import { dispatchInsert } from "../dispatchers/insertDispatch";
import { dispatchAiMcp } from "../dispatchers/aiMcpDispatch";

const makeEvent = (type: string) => ({ id: "req-1", type, args: {} });

beforeEach(() => {
  vi.clearAllMocks();
});

const ROUTE_TABLE: Record<string, string[]> = {
  document: [
    "document.getContent",
    "document.setContent",
    "document.insertAtCursor",
    "document.insertAtPosition",
    "document.search",
    "document.replaceInSource",
    "outline.get",
    "metadata.get",
    "selection.get",
    "selection.set",
    "selection.replace",
    "suggestion.accept",
    "suggestion.reject",
    "suggestion.list",
    "suggestion.acceptAll",
    "suggestion.rejectAll",
    "cursor.getContext",
    "cursor.setPosition",
  ],
  editor: [
    "format.toggle",
    "format.setLink",
    "format.removeLink",
    "format.clear",
    "editor.undo",
    "editor.redo",
    "editor.focus",
    "editor.getUndoState",
    "editor.setMode",
    "block.setType",
    "block.insertHorizontalRule",
    "list.toggle",
    "list.increaseIndent",
    "list.decreaseIndent",
    "table.insert",
    "table.delete",
  ],
  workspace: [
    "windows.list",
    "windows.getFocused",
    "windows.focus",
    "workspace.newDocument",
    "workspace.openDocument",
    "workspace.saveDocument",
    "workspace.saveDocumentAs",
    "workspace.getDocumentInfo",
    "workspace.closeWindow",
    "workspace.listRecentFiles",
    "workspace.getInfo",
    "workspace.reloadDocument",
    "tabs.list",
    "tabs.getActive",
    "tabs.switch",
    "tabs.close",
    "tabs.create",
    "tabs.getInfo",
    "tabs.reopenClosed",
    "genies.list",
    "genies.read",
    "genies.invoke",
  ],
  insert: [
    "vmark.insertMathInline",
    "vmark.insertMathBlock",
    "vmark.insertMermaid",
    "vmark.insertMarkmap",
    "vmark.insertSvg",
    "vmark.insertWikiLink",
    "vmark.cjkPunctuationConvert",
    "vmark.cjkSpacingFix",
    "vmark.cjkFormat",
    "smartInsert",
    "insertMedia",
  ],
  aiMcp: [
    "protocol.getCapabilities",
    "protocol.getRevision",
    "structure.getAst",
    "structure.getDigest",
    "structure.listBlocks",
    "structure.resolveTargets",
    "structure.getSection",
    "mutation.batchEdit",
    "mutation.applyDiff",
    "mutation.replaceAnchored",
    "section.update",
    "section.insert",
    "section.move",
    "paragraph.read",
    "paragraph.write",
    "table.batchModify",
    "list.batchModify",
  ],
};

const DISPATCHERS = {
  document: dispatchDocument,
  editor: dispatchEditor,
  workspace: dispatchWorkspace,
  insert: dispatchInsert,
  aiMcp: dispatchAiMcp,
} as const;

describe("sub-dispatchers — claim their advertised types", () => {
  for (const [dispatcher, routes] of Object.entries(ROUTE_TABLE)) {
    describe(`dispatch${dispatcher[0].toUpperCase() + dispatcher.slice(1)}`, () => {
      it.each(routes)("claims %s", async (type) => {
        const fn = DISPATCHERS[dispatcher as keyof typeof DISPATCHERS];
        await expect(fn(makeEvent(type))).resolves.toBe(true);
      });

      it("does not claim an unknown type", async () => {
        const fn = DISPATCHERS[dispatcher as keyof typeof DISPATCHERS];
        await expect(fn(makeEvent("nope.unknown"))).resolves.toBe(false);
      });
    });
  }
});

describe("sub-dispatchers — no route overlap", () => {
  it("each advertised type is claimed by exactly one dispatcher", async () => {
    for (const [owner, routes] of Object.entries(ROUTE_TABLE)) {
      for (const type of routes) {
        const claims: string[] = [];
        for (const [name, fn] of Object.entries(DISPATCHERS)) {
          if (await fn(makeEvent(type))) claims.push(name);
        }
        expect(claims, `type ${type} expected to be claimed only by ${owner}`).toEqual([owner]);
      }
    }
  });
});
