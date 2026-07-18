/**
 * Coherence capture funnel (WI-1.6)
 *
 * Purpose: report successful workspace writes to the Rust coherence kernel
 * (`coherence_capture`) so every write becomes a Transformation with
 * provenance (spec §5.4.1). Fire-and-forget by design: a failed capture
 * logs and returns null — it never fails the write it describes (the scan
 * reconciler heals any gap, spec §9.4).
 *
 * Key decisions:
 *   - Only files inside the open workspace are captured; the kernel owns
 *     coherence state per workspace root.
 *   - When the kernel rewrites the file to (re)insert the identity block,
 *     a pending save is registered with the rewritten content so the file
 *     watcher swallows the kernel's own write instead of prompting.
 *
 * @coordinates-with src-tauri/src/coherence/commands.rs — coherence_capture
 * @coordinates-with pendingSaves.ts — watcher echo suppression
 * @module services/coherence/captureFunnel
 */
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { registerPendingSave, clearPendingSave } from "@/utils/pendingSaves";
import { coherenceLog } from "@/utils/debug";

export interface CoherenceCaptureInput {
  path?: string;
  object_id?: string;
  revision?: string;
  role: "direct" | "contextual";
}

export interface CaptureAiEditArgs {
  tabId: string;
  modelId?: string;
  intentKind: string;
  summary: string;
  /** Buffer had uncaptured human edits when the AI ran (read BEFORE the
   *  apply) — the true input state is then no ledger revision (spec §8). */
  bufferWasDirty: boolean;
}

export interface CaptureWriteArgs {
  /** Absolute path of the file that was written. */
  absolutePath: string;
  /** The exact content written (plan contract — no disk re-read). */
  content: string;
  inputs?: CoherenceCaptureInput[];
  agent: { type: "human" | "model" | "external"; id?: string };
  intent: { kind: string; summary: string };
  /** Defaults to "exact" (in-app paths); MCP writes pass "inferred". */
  confidence?: "exact" | "inferred";
  /** False = record the revision without rewriting the file's identity
   *  block on disk (empty explorer-created files; live buffers). */
  rewriteIdentity?: boolean;
}

export interface CoherenceCaptureReceipt {
  object: string;
  revision: string;
  entry_id: string | null;
  content_with_identity: string | null;
}

/**
 * Workspace-relative path with prefix-boundary safety: `/ws/storyboard`
 * is not inside `/ws/story`. Returns null for files outside the root.
 */
export function workspaceRelativePath(root: string, absolutePath: string): string | null {
  const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  if (!absolutePath.startsWith(normalizedRoot + "/")) return null;
  const rel = absolutePath.slice(normalizedRoot.length + 1);
  return rel.length > 0 ? rel : null;
}

/** Capture one successful write. Never throws; null = not captured. */
export async function captureWrite(
  args: CaptureWriteArgs
): Promise<CoherenceCaptureReceipt | null> {
  try {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) return null;
    const rel = workspaceRelativePath(root, args.absolutePath);
    if (!rel) return null;
    const receipt = await invoke<CoherenceCaptureReceipt>("coherence_capture", {
      workspaceRoot: root,
      request: {
        path: rel,
        content: args.content,
        inputs: args.inputs ?? [],
        agent: args.agent,
        intent: args.intent,
        confidence: args.confidence ?? "exact",
        rewrite_identity: args.rewriteIdentity ?? true,
      },
    });
    if (receipt.content_with_identity) {
      // The kernel rewrote the file on disk; let the watcher match it.
      const token = registerPendingSave(args.absolutePath, receipt.content_with_identity);
      setTimeout(() => clearPendingSave(args.absolutePath, token), 1000);
    }
    return receipt;
  } catch (error) {
    coherenceLog("capture failed (write unaffected):", error);
    return null;
  }
}

/**
 * Capture an AI edit applied to a live editor buffer (genie auto-apply or
 * suggestion accept). The kernel records the buffer revision WITHOUT
 * touching the file on disk (`rewrite_identity: false`); the next real
 * save is then a no-op capture unless the human edited further.
 */
export async function captureAiEdit(
  args: CaptureAiEditArgs
): Promise<CoherenceCaptureReceipt | null> {
  try {
    const doc = useDocumentStore.getState().getDocument(args.tabId);
    if (!doc?.filePath) return null; // untitled — adopted at first save
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) return null;
    const rel = workspaceRelativePath(root, doc.filePath);
    if (!rel) return null;
    return await invoke<CoherenceCaptureReceipt>("coherence_capture", {
      workspaceRoot: root,
      request: {
        path: rel,
        content: doc.content,
        inputs: [{ path: rel, role: "direct" }],
        agent: { type: "model", id: args.modelId },
        intent: { kind: args.intentKind, summary: args.summary },
        confidence: args.bufferWasDirty ? "inferred" : "exact",
        rewrite_identity: false,
      },
    });
  } catch (error) {
    coherenceLog("AI-edit capture failed (edit unaffected):", error);
    return null;
  }
}

// ── MCP session-read tracking (WI-1.6, spec §7 example 2) ───────────────
// Documents an external MCP client read since its last write become the
// (inferred) input set of that write. Module-level state is correct here:
// one webview = one bridge session.
const sessionReads = new Set<string>();

/** Record a document read served to the MCP client (absolute path). */
export function recordMcpRead(absolutePath: string): void {
  sessionReads.add(absolutePath);
}

/** Consume the session-read set as capture inputs for an MCP write. */
export function takeMcpReadInputs(root: string): CoherenceCaptureInput[] {
  const inputs: CoherenceCaptureInput[] = [];
  for (const abs of sessionReads) {
    const rel = workspaceRelativePath(root, abs);
    if (rel) inputs.push({ path: rel, role: "direct" });
  }
  sessionReads.clear();
  return inputs;
}

/**
 * Capture an MCP bridge write (document.write / workspace.save). Always
 * `inferred` — the external agent's true context is unobservable (G1
 * finding 2); the session-observed read set is an honest under-
 * approximation.
 */
export async function captureMcpWrite(args: {
  absolutePath: string;
  content: string;
  toolName: string;
}): Promise<CoherenceCaptureReceipt | null> {
  try {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) return null;
    const inputs = takeMcpReadInputs(root).filter((i) => {
      // The written doc itself is the transformation target, not an input.
      return i.path !== workspaceRelativePath(root, args.absolutePath);
    });
    return await captureWrite({
      absolutePath: args.absolutePath,
      content: args.content,
      inputs,
      agent: { type: "model", id: "mcp-client" },
      intent: { kind: "mcp-document-write", summary: args.toolName },
      confidence: "inferred",
    });
  } catch (error) {
    coherenceLog("MCP capture failed (write unaffected):", error);
    return null;
  }
}
