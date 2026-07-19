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
import { registerCommand } from "./CommandBus";
import { useClaimStore } from "@/stores/claimStore";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getActiveDocument } from "@/services/navigation/activeDocument";
import { workspaceRelativePath } from "@/services/coherence/captureFunnel";

type Ctx = { windowLabel?: string };

let registered = false;

export function registerClaimCommands(): void {
  if (registered) return;

  registerCommand({
    id: "view.toggleClaims",
    title: () => i18n.t("commands:view.toggleClaims"),
    category: "view",
    run: () => useClaimStore.getState().togglePanel(),
  });

  registerCommand({
    id: "claims.extractFromSelection",
    title: () => i18n.t("commands:claims.extractFromSelection"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const editor = useEditorStore.getState().tiptap.editor;
      const root = useWorkspaceStore.getState().rootPath;
      const doc = getActiveDocument(windowLabel);
      if (!editor || !root || !doc?.filePath) return;
      const rel = workspaceRelativePath(root, doc.filePath);
      if (!rel) return;
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, "\n").trim();
      if (text === "") return;
      // Hand the draft to the panel — the explicit human accept happens
      // there (D2.6: nothing persists without it).
      useClaimStore.getState().setDraft(text, rel);
    },
  });

  registered = true;
}
