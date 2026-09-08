/**
 * Claim commands (WI-2b.6) — the panel toggle and the ONE claim-creation
 * entry point: extract-from-selection (design-2a.md D2.2 — creation
 * always carries provenance, so it exists only where a source document
 * selection exists). Palette-invoked; no menu items yet.
 *
 * @coordinates-with stores/claimStore.ts — draft handover to the panel
 * @module services/commands/claimCommands
 */
import i18n from "@/i18n";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import { useClaimStore } from "@/stores/claimStore";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getActiveDocument, getActiveTabId } from "@/services/navigation/activeDocument";
import { workspaceRelativePath } from "@/services/coherence/captureFunnel";

type Ctx = { windowLabel?: string };

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const CLAIM_COMMANDS_OWNER = "claim-commands";

/** Everything an extraction needs, resolved together, or null when it cannot run. */
interface ClaimSource {
  /** The WYSIWYG editor showing the active tab. */
  editor: NonNullable<ReturnType<typeof activeWysiwygEditorForTab>>;
  /** The active document's path, relative to the workspace root. */
  relativePath: string;
}

function activeWysiwygEditorForTab(windowLabel: string) {
  // The TAB-BOUND active editor, not the generic Tiptap registration
  // (audit #887). `tiptap.editor` is whichever editor registered last — in a
  // split pane, or with a Source pane focused, that is not necessarily the
  // editor showing the active document, so the selection read from it belongs
  // to a different tab than the provenance below. A claim must carry the
  // provenance of the text it quotes, so the two have to be the SAME tab or
  // there is nothing to extract.
  const active = useEditorStore.getState().active;
  const tabId = getActiveTabId(windowLabel);
  if (!tabId || active.activeWysiwygTabId !== tabId) return null;
  return active.activeWysiwygEditor;
}

/**
 * Resolve the extraction's prerequisites: a tab-bound editor with a non-empty
 * selection, in a saved document inside the open workspace.
 *
 * Shared by the command's `when` and its `run` (audit #883/#885), so the
 * availability the palette shows and the work the command does cannot disagree.
 * The emptiness test here is the O(1) `selection.empty`; whether the selected
 * range is only whitespace is left to `run`, which has the text in hand anyway.
 */
function resolveClaimSource(windowLabel: string): ClaimSource | null {
  const editor = activeWysiwygEditorForTab(windowLabel);
  if (!editor || editor.state.selection.empty) return null;
  const root = useWorkspaceStore.getState().rootPath;
  const doc = getActiveDocument(windowLabel);
  if (!root || !doc?.filePath) return null;
  const relativePath = workspaceRelativePath(root, doc.filePath);
  return relativePath === null ? null : { editor, relativePath };
}

/**
 * Hand the selected text — with its provenance — to the claims panel.
 *
 * A named handler rather than a body inlined in the registration (audit #883):
 * this is the claim-extraction rule, and it is the thing worth reading and
 * testing on its own.
 */
function extractClaimFromSelection(windowLabel: string): void {
  const source = resolveClaimSource(windowLabel);
  if (!source) return;
  const { from, to } = source.editor.state.selection;
  const text = source.editor.state.doc.textBetween(from, to, "\n").trim();
  if (text === "") return;
  // Hand the draft to the panel — the explicit human accept happens there
  // (D2.6: nothing persists without it).
  useClaimStore.getState().setDraft(text, source.relativePath);
}

/** Build the claim command specs (pure — no registration). */
function buildClaimCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "view.toggleClaims",
      title: () => i18n.t("commands:view.toggleClaims"),
      category: "view",
      run: () => useClaimStore.getState().togglePanel(),
    },
    {
      id: "claims.extractFromSelection",
      title: () => i18n.t("commands:claims.extractFromSelection"),
      category: "view",
      // Its prerequisites are real and checkable (audit #885): without them the
      // palette offered a row that reported a successful dispatch and did
      // nothing at all. `when` is honoured by both `searchCommands` and
      // `executeCommand`, so the row disappears AND the dispatch says no.
      when: (ctx) => resolveClaimSource((ctx as Ctx).windowLabel ?? "main") !== null,
      run: (_args, ctx: Ctx) => extractClaimFromSelection(ctx.windowLabel ?? "main"),
    },
  ];
}

/**
 * Register the claim command set as ONE owner batch (audit #884).
 *
 * A `hasCommand("view.toggleClaims")` sentinel answered "is this id taken?",
 * which is not the question: a foreign registrar holding it reported the whole
 * set as installed, and a mid-batch failure left the second command missing
 * with every retry skipping it. `registerCommands` PREFLIGHTS both ids and
 * replaces its own previous batch — the same shape viewCommands uses (#459).
 */
export function registerClaimCommands(): void {
  registerCommands(CLAIM_COMMANDS_OWNER, buildClaimCommandSpecs());
}
