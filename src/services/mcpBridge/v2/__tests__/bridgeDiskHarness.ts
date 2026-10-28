/**
 * Shared setup for the bridge suites whose claim is about BYTES ON DISK.
 *
 * These suites run the real handler over the real stores and the real save
 * pipeline; `@tauri-apps/*` is the only mocked boundary, behind the stateful
 * disk fake. A handler test that mocks the writer can only say "the writer was
 * called" — which is how three bridge handlers kept writing around the save
 * pipeline with every test green.
 *
 * Each suite wires the two mock factories itself (vi.mock is hoisted per file),
 * from `bridgeWriteGate.ts` — NOT from this module, which imports the app and
 * therefore the very modules being mocked:
 *
 *     vi.mock("@tauri-apps/plugin-fs", async () =>
 *       (await import("./bridgeWriteGate")).gatedFsModule());
 *     vi.mock("@tauri-apps/api/core", async () =>
 *       (await import("./bridgeWriteGate")).gatedCoreModule());
 *
 * @coordinates-with bridgeWriteGate.ts — the mocked Tauri surface and the write gate
 * @coordinates-with test/statefulFsFake.ts — the disk
 * @coordinates-with test/tier0/harness.ts — store reset and the real open flow
 * @module services/mcpBridge/v2/__tests__/bridgeDiskHarness
 */
import { statefulFs } from "@/test/statefulFsFake";
import { resetTier0 } from "@/test/tier0/harness";
import { useRevisionStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { __resetSerializer } from "@/services/persistence/serializeByPath";
import { resetSaveTargetClaims } from "@/services/persistence/saveTargetClaim";
import type { McpResponse } from "@/services/mcpBridge/types";
import { writeGate } from "./bridgeWriteGate";

/** One `coherence_capture` call as it reached the kernel boundary. */
export interface CaptureCall {
  workspaceRoot: string;
  policy: string;
  request: {
    path: string;
    content: string;
    confidence: string;
    agent: { type: string; id?: string };
    intent: { kind: string; summary: string };
  };
}

/** Every reply the handlers sent, in order. */
const responses: McpResponse[] = [];
/** Every provenance capture that reached the kernel boundary, in order. */
export const captures: CaptureCall[] = [];

/** Set the MCP auto-approve-edits toggle. */
export function setAutoApproveEdits(value: boolean): void {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({
    advanced: { ...s.advanced, mcpServer: { ...s.advanced.mcpServer, autoApproveEdits: value } },
  });
}

/**
 * Reset the disk, every store the handlers touch, and the save pipeline's
 * module state; then stub the non-filesystem commands a bridge write reaches.
 * Each stub is a named claim that the command is not what the test is about;
 * an unlisted command still rejects loudly.
 */
export function resetBridge(): void {
  writeGate.reset();
  resetTier0();
  // Where checkpoints and history live (the mocked appDataDir).
  statefulFs.mkdirp("/Users/test/.config");
  responses.length = 0;
  captures.length = 0;
  __resetSerializer();
  resetSaveTargetClaims();
  useRevisionStore.setState({ revisions: {} });
  setAutoApproveEdits(true);
  statefulFs.stubCommand("mcp_bridge_respond", (args) => {
    responses.push(args.payload as McpResponse);
  });
  // The path guard's symlink resolution; its policy is tested on its own.
  statefulFs.stubCommand("mcp_bridge_check_path", () => undefined);
  statefulFs.stubCommand("coherence_capture", (args) => {
    captures.push(args as unknown as CaptureCall);
    return null; // the kernel declines: nothing is stamped into the file
  });
  statefulFs.stubCommand("coherence_head", () => null);
}

/** The reply to request `id`; a missing reply is a loud failure. */
export function responseTo(id: string): McpResponse {
  const found = responses.filter((r) => r.id === id);
  if (found.length !== 1) {
    throw new Error(`bridgeDiskHarness: expected one reply to ${id}, got ${found.length}`);
  }
  return found[0];
}

/** The structured error a failed reply carries, or null when it is not one. */
export function structuredErrorOf(response: McpResponse): {
  error: string;
  message: string;
  current_revision?: string;
} | null {
  if (response.success || !response.error) return null;
  try {
    return JSON.parse(response.error);
  } catch {
    return null;
  }
}
