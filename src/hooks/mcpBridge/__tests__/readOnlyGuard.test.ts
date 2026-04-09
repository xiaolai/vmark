import { describe, it, expect } from "vitest";
import { isBlockedInReadOnly, READ_ONLY_ERROR } from "../readOnlyGuard";

describe("MCP readOnlyGuard", () => {
  it("exports a descriptive error message", () => {
    expect(READ_ONLY_ERROR).toContain("read-only");
  });

  describe("isBlockedInReadOnly", () => {
    // Write operations — should be blocked
    const writeOps = [
      "document.setContent",
      "document.insertAtCursor",
      "document.insertAtPosition",
      "document.replaceInSource",
      "selection.replace",
      "format.toggle",
      "format.setLink",
      "format.removeLink",
      "format.clear",
      "editor.undo",
      "editor.redo",
      "block.setType",
      "block.insertHorizontalRule",
      "list.toggle",
      "list.increaseIndent",
      "list.decreaseIndent",
      "table.insert",
      "table.delete",
      "table.addRowBefore",
      "table.addRowAfter",
      "table.deleteRow",
      "table.addColumnBefore",
      "table.addColumnAfter",
      "table.deleteColumn",
      "table.toggleHeaderRow",
      "table.batchModify",
      "list.batchModify",
      "mutation.batchEdit",
      "mutation.applyDiff",
      "mutation.replaceAnchored",
      "section.update",
      "section.insert",
      "section.move",
      "paragraph.write",
      "smartInsert",
      "insertMedia",
      "suggestion.accept",
      "suggestion.acceptAll",
      "genies.invoke",
    ];

    it.each(writeOps)("blocks write op: %s", (op) => {
      expect(isBlockedInReadOnly(op)).toBe(true);
    });

    // Read operations — should pass through
    const readOps = [
      "document.getContent",
      "document.search",
      "outline.get",
      "metadata.get",
      "selection.get",
      "selection.set",
      "cursor.getContext",
      "cursor.setPosition",
      "editor.focus",
      "editor.setMode",
      "editor.getUndoState",
      "structure.getAst",
      "structure.getDigest",
      "structure.listBlocks",
      "structure.resolveTargets",
      "structure.getSection",
      "paragraph.read",
      "suggestion.reject",
      "suggestion.rejectAll",
      "suggestion.list",
      "workspace.newDocument",
      "workspace.openDocument",
      "workspace.saveDocument",
      "workspace.getDocumentInfo",
      "tabs.list",
      "tabs.getActive",
      "tabs.switch",
      "windows.list",
      "protocol.getCapabilities",
      "protocol.getRevision",
    ];

    it.each(readOps)("allows read op: %s", (op) => {
      expect(isBlockedInReadOnly(op)).toBe(false);
    });

    it("allows unknown operations through", () => {
      expect(isBlockedInReadOnly("unknown.operation")).toBe(false);
    });

    // #697: selection.delete and block.toggle have no frontend handler.
    // They must NOT appear in the write ops set (dead protocol definitions removed).
    it.each(["selection.delete", "block.toggle"])(
      "does not recognize removed dead protocol type: %s",
      (op) => {
        expect(isBlockedInReadOnly(op)).toBe(false);
      }
    );
  });
});
