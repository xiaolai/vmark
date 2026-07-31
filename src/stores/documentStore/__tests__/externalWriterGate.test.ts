/**
 * Structural gate: WHO may write text into the document store (WI-1.5).
 *
 * Enumerating ingress call sites by hand is how revision 1 of the plan missed
 * three and revision 2 missed eight. This gate inverts the burden: the modules
 * allowed to write EXTERNAL text into the store are LISTED, and any new caller
 * fails here until it is reviewed and either routed through the boundary or
 * added with a reason.
 *
 * Two separate rules:
 *   1. `setContent` is dead as a production API — every editor-domain writer
 *      calls `setEditorContent` (asserted canonical in dev), every external
 *      writer goes through `initDocument` / `loadContent` /
 *      `ingestExternalContent` (canonicalising).
 *   2. The external doors have an allow-list of calling modules.
 *
 * @coordinates-with stores/documentStore/document.ts — the doors
 * @module stores/documentStore/__tests__/externalWriterGate.test
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const SRC = join(__dirname, "../../..");

/** Repo-relative production .ts/.tsx files whose text matches `pattern`. */
function productionCallers(pattern: string): string[] {
  let out = "";
  try {
    out = execFileSync(
      "grep",
      ["-rlE", pattern, SRC, "--include=*.ts", "--include=*.tsx"],
      { encoding: "utf8" },
    );
  } catch (error) {
    // grep exits 1 on zero matches — that is a PASS, not an error.
    const status = (error as { status?: number }).status;
    if (status !== 1) throw error;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((p) => p.slice(SRC.length + 1).replace(/\\/g, "/"))
    .filter((p) => !/\.test\.|__tests__|testUtils/.test(p))
    .sort();
}

describe("setContent is no longer a production API", () => {
  it("no production module calls documentStore setContent", () => {
    // Matches both `useDocumentStore.getState().setContent(` and
    // `docStore.setContent(` shapes while excluding OTHER stores' setContent
    // (footnote popup) and Tiptap's editor.commands.setContent by checking the
    // store file's own callers explicitly below.
    const callers = productionCallers(
      String.raw`(documentStore|docStore|docState)[^\n]*\.setContent\(|useDocumentStore\s*\.\s*getState\(\)\.setContent\(`,
    );
    expect(callers).toEqual([]);
  });
});

describe("external text enters only through listed modules", () => {
  // Everything here has been REVIEWED as an ingress: it either reads from
  // disk, restores a snapshot, or receives text from outside the editor.
  // Adding a module to this list is a claim that it canonicalises via the
  // store's doors — not a way to silence the gate.
  const ALLOWED = new Set([
    // The store itself and its composition root.
    "stores/documentStore/document.ts",
    "main.tsx",
    // Disk opens and reloads.
    "services/navigation/fileOpen.ts",
    "services/navigation/replaceTabWithFile.ts",
    "services/navigation/openMediaFile.ts",
    "services/navigation/newFile.ts",
    "services/navigation/restoreWorkspaceTabs.ts",
    "services/persistence/reloadFromDisk.ts",
    "hooks/useFinderFileOpen.ts",
    "hooks/useWorkspaceBootstrap.ts",
    "hooks/useExternalFileChanges.ts",
    "hooks/useDocumentState.ts",
    "contexts/startupFileOpen.ts",
    // Snapshot and history restoration.
    "services/persistence/hotExit/restoreHelpers.ts",
    "hooks/resilience/_crashRecoveryStartup.ts",
    "services/history/unifiedHistory.ts",
    "components/Sidebar/HistoryView.tsx",
    "components/McpHistory/McpHistoryButton.tsx",
    // Tab / workspace transfer (in-memory, already canonical).
    "contexts/tabTransferHandlers.ts",
    "components/StatusBar/tabTransferActions.ts",
    "components/StatusBar/StatusBar.tsx",
    "services/workspaces/workspaceWindowActions.ts",
    // MCP bridge.
    "hooks/mcpBridge/v2/workspace.ts",
    // Terminal file links, new-tab commands.
    "components/Terminal/setupFileLinks.ts",
    "hooks/tabCommands.ts",
  ]);

  it("every initDocument/loadContent/ingestExternalContent caller is listed", () => {
    const callers = productionCallers(
      String.raw`\.(initDocument|loadContent|ingestExternalContent)\(`,
    );
    const unlisted = callers.filter((c) => !ALLOWED.has(c));
    expect(unlisted).toEqual([]);
  });
});
