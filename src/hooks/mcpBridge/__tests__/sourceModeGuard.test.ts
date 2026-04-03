/**
 * Tests for source mode guard in MCP bridge dispatcher.
 *
 * Verifies that editor-dependent MCP tools are blocked in source mode
 * while editor-independent tools and unknown ops pass through.
 */

import { describe, it, expect } from "vitest";
import { isBlockedInSourceMode, hasSourceHandler, SOURCE_MODE_ERROR } from "../sourceModeGuard";

describe("sourceModeGuard", () => {
  describe("isBlockedInSourceMode", () => {
    describe("editor-dependent operations (should be blocked)", () => {
      it.each([
        "document.setContent",
        "document.insertAtCursor",
        "document.insertAtPosition",
        "document.search",
        "document.replaceInSource",
        "selection.get",
        "selection.set",
        "selection.replace",
        "cursor.getContext",
        "cursor.setPosition",
        "format.toggle",
        "format.setLink",
        "format.removeLink",
        "format.clear",
        "block.setType",
        "block.insertHorizontalRule",
        "list.toggle",
        "list.increaseIndent",
        "list.decreaseIndent",
        "table.insert",
        "table.delete",
        "table.batchModify",
        "list.batchModify",
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
        "smartInsert",
        "insertMedia",
        "vmark.insertMathInline",
        "vmark.insertMathBlock",
        "vmark.insertMermaid",
        "vmark.insertMarkmap",
        "vmark.insertSvg",
        "vmark.insertWikiLink",
        "vmark.cjkPunctuationConvert",
        "vmark.cjkSpacingFix",
        "vmark.cjkFormat",
        "suggestion.accept",
        "suggestion.reject",
        "suggestion.list",
        "suggestion.acceptAll",
        "suggestion.rejectAll",
        "genies.invoke",
      ])("blocks %s in source mode", (type) => {
        expect(isBlockedInSourceMode(type)).toBe(true);
      });
    });

    describe("editor-independent operations (should pass through)", () => {
      it.each([
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
        "tabs.switch",
        "tabs.close",
        "tabs.create",
        "tabs.getInfo",
        "tabs.reopenClosed",
        "protocol.getCapabilities",
        "protocol.getRevision",
        "genies.list",
        "genies.read",
        "editor.undo",
        "editor.redo",
        "editor.getUndoState",
        "editor.setMode",
      ])("allows %s in source mode", (type) => {
        expect(isBlockedInSourceMode(type)).toBe(false);
      });
    });

    describe("unknown operations (should pass through to default handler)", () => {
      it.each([
        "foo.bar",
        "unknown.operation",
        "nonexistent",
        "",
      ])("does not block unknown op %j", (type) => {
        expect(isBlockedInSourceMode(type)).toBe(false);
      });
    });
  });

    describe("source-capable operations (not blocked, have source handlers)", () => {
      it.each([
        "document.getContent",
        "outline.get",
        "metadata.get",
        "editor.focus",
      ])("%s is not blocked and has a source handler", (type) => {
        expect(isBlockedInSourceMode(type)).toBe(false);
        expect(hasSourceHandler(type)).toBe(true);
      });
    });

  describe("SOURCE_MODE_ERROR", () => {
    it("tells MCP clients to call editor.setMode", () => {
      expect(SOURCE_MODE_ERROR).toContain("WYSIWYG");
      expect(SOURCE_MODE_ERROR).toContain("editor.setMode");
    });
  });
});
