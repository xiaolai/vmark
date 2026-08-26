// @vitest-environment node
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
 *   1. `setContent` is GONE, not merely unused. It survived as a one-line
 *      delegation to `setEditorContent` that only tests called, which is a
 *      deprecated API kept alive by its own test suite — so the 97 test call
 *      sites were migrated and the action deleted. Every editor-domain writer
 *      calls `setEditorContent` (asserted canonical in dev), every external
 *      writer goes through `initDocument` / `ingestExternalContent`
 *      (canonicalising). `loadContent` was deleted the same way, as a
 *      duplicate that had drifted; the gate below flags either coming back.
 *   2. The external doors have an allow-list of calling modules.
 *
 * @coordinates-with stores/documentStore/document.ts — the doors
 * @module stores/documentStore/__tests__/externalWriterGate.test
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

describe("setContent is gone, not merely unused", () => {
  it("the store does not expose it at all", async () => {
    // Stronger than "nothing calls it", in two ways. An action that exists can
    // be called — and while it existed, its only callers were tests, so the
    // gate below passed and the API stayed alive indefinitely on the strength
    // of its own suite.
    //
    // The regex gate below is also BLIND to `const { setContent } =
    // useDocumentStore.getState()`, which has no `.setContent(` on it. That
    // shape is real: it was how the last 13 call sites were written, and the
    // grep-driven migration missed every one of them until the typechecker
    // said so. Removing the action closes that hole outright — you cannot
    // destructure what is not there — which is why this assertion, not the
    // pattern match, is the one carrying the property.
    const { useDocumentStore } = await import("../document");
    expect("setContent" in useDocumentStore.getState()).toBe(false);
    expect("setEditorContent" in useDocumentStore.getState()).toBe(true);
  });

  it("is not declared on the contract either", () => {
    const contract = readFileSync(join(SRC, "stores/documentStore/storeContract.ts"), "utf8");
    expect(contract).not.toMatch(/^\s*setContent:/m);
  });

  it("no production module calls documentStore setContent", () => {
    // Matches both `useDocumentStore.getState().setEditorContent(` and
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
    "services/navigation/loadFileIntoTab.ts",
    "services/persistence/reloadFromDisk.ts",
    "hooks/useWorkspaceBootstrap.ts",
    // The fs-watcher's reaction policy. It MOVED here out of
    // `hooks/useExternalFileChanges.ts`, which no longer ingests at all —
    // this is that same reviewed ingress under its own module, not a new
    // door. The gate caught the move, which is what it is for.
    "services/files/applyModifyPolicy.ts",
    "hooks/useDocumentState.ts",
    "contexts/startupFileOpen.ts",
    // Snapshot and history restoration.
    "services/persistence/hotExit/restoreHelpers.ts",
    "services/persistence/hotExit/restoreDocumentState.ts",
    "hooks/resilience/_crashRecoveryStartup.ts",
    "services/history/unifiedHistory.ts",
    "components/Sidebar/HistoryView.tsx",
    "components/McpHistory/McpHistoryButton.tsx",
    // Tab / workspace transfer (in-memory, already canonical).
    "contexts/tabTransferHandlers.ts",
    "components/StatusBar/tabTransferActions.ts",
    "components/StatusBar/StatusBar.tsx",
    "services/workspaces/workspaceWindowActions.ts",
    // MCP bridge — workspace opens a file (disk-open), document.write applies
    // an AI payload (mcp-write: an EDIT that keeps the file's convention).
    "services/mcpBridge/v2/workspace.ts",
    "services/mcpBridge/v2/workspaceOpen.ts",
    "services/mcpBridge/v2/document.ts",
    // Terminal file links, new-tab commands.
    "components/Terminal/setupFileLinks.ts",
    "services/commands/tabCommands.ts",
  ]);

  it("every initDocument/ingestExternalContent caller is listed", () => {
    const callers = productionCallers(
      String.raw`\.(initDocument|ingestExternalContent)\(`,
    );
    const unlisted = callers.filter((c) => !ALLOWED.has(c));
    expect(unlisted).toEqual([]);
  });
});
