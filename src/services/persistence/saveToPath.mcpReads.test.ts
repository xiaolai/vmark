// The MCP door freezes its client's read set when the save is submitted: a read the client makes while the save is queued or writing belongs to its next write, never to this one, and a save that wrote nothing gives its reads back for that next write (a path read again meanwhile keeps the newer read).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readInputsOf } from "@/test/mcpReadInputs";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { imeToast } from "@/services/ime/imeToast";
import { detachMcpReads, dropAllMcpConnectionReads, recordMcpRead } from "@/services/coherence/mcpCapture";
import { saveToPathForMcp } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { resetSaveTargetClaims } from "./saveTargetClaim";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";

const DOC = `${ROOT}/notes.md`;
const CONN = TEST_ATTRIBUTION.connectionId;
let captured: string[][] = [];

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  dropAllMcpConnectionReads();
  captured = [];
  // The pinned revision names the content served, so a test can tell two reads of one path apart.
  statefulFs.stubCommand("coherence_head", (args) => ({ object: "o", revision: `served:${String(args.content)}` }));
  statefulFs.stubCommand("coherence_capture", (args) => {
    const request = args.request as { inputs: { path: string }[] };
    captured.push(request.inputs.map((i) => i.path));
    return null;
  });
});

afterEach(() => {
  dropAllMcpConnectionReads();
  vi.restoreAllMocks();
});

const remaining = () => readInputsOf(detachMcpReads(CONN), ROOT).map((i) => i.path).sort();
/** The read set's pinned revisions by path, once the pins have answered. */
async function takeRevisions(): Promise<Record<string, string | undefined>> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return Object.fromEntries(readInputsOf(detachMcpReads(CONN), ROOT).map((i) => [i.path, i.revision]));
}

describe("saveToPathForMcp — the client's reads", () => {
  it("a read made while the save is writing belongs to the next write, not this one", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    recordMcpRead(CONN, `${ROOT}/before.md`, "before");
    let finishWrite: (() => void) | null = null;
    statefulFs.stubCommand("atomic_write_file", () => new Promise<void>((resolve) => (finishWrite = resolve)));
    const saving = saveToPathForMcp(tabId, DOC, "b\n", "document.write", TEST_ATTRIBUTION);
    await vi.waitFor(() => expect(finishWrite).not.toBeNull());
    recordMcpRead(CONN, `${ROOT}/后来.md`, "later");
    finishWrite!();
    expect(await saving).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(captured).toHaveLength(1));

    expect(captured[0]).toEqual(["before.md"]);
    expect(remaining()).toEqual(["后来.md"]);
  });

  it("a save that wrote nothing gives its reads back, a path read again keeping the newer read", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "id");
    recordMcpRead(CONN, `${ROOT}/x.md`, "x1");
    recordMcpRead(CONN, `${ROOT}/y.md`, "y");
    let failWrite: ((e: unknown) => void) | null = null;
    statefulFs.stubCommand("atomic_write_file", () => new Promise<void>((_, reject) => (failWrite = reject)));
    const saving = saveToPathForMcp(tabId, DOC, "b\n", "workspace.save", TEST_ATTRIBUTION);
    await vi.waitFor(() => expect(failWrite).not.toBeNull());
    recordMcpRead(CONN, `${ROOT}/x.md`, "x2");
    failWrite!({ code: "io", message: "disk full" });
    expect(await saving).toMatchObject({ ok: false, reason: "write-failed" });

    expect(captured).toEqual([]);
    expect(await takeRevisions()).toEqual({ "x.md": "served:x2", "y.md": "served:y" });
  });
});
