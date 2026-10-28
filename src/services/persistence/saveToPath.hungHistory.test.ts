// @vitest-environment node
// A history backend that never answers holds a save only until the snapshot
// deadline: the save then resolves as written, and the next save queued on
// the same path reaches the disk. Real stores and pipeline over the stateful
// disk fake; only `@tauri-apps/*` and the history backend are replaced.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
const createSnapshot = vi.hoisted(() => vi.fn(() => new Promise<void>(() => {})));
vi.mock("@/services/history/historyOperations", () => ({ createSnapshot }));

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, editDoc, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { saveToPath } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { resetSaveTargetClaims } from "./saveTargetClaim";
import { SNAPSHOT_TIMEOUT_MS } from "./saveHistorySnapshot";

const DOC = `${ROOT}/notes.md`;

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  statefulFs.stubCommand("coherence_capture", () => null);
  statefulFs.stubCommand("coherence_head", () => null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a save whose history snapshot never answers", () => {
  it("resolves at the snapshot deadline, and the save queued behind it writes", async () => {
    const tabId = await openDocInTab(DOC, "zero\n");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    editDoc(tabId, "one\n");
    let firstDone = false;
    const first = saveToPath(tabId, DOC, "one\n", "manual").then((ok) => ((firstDone = true), ok));
    editDoc(tabId, "two\n");
    const second = saveToPath(tabId, DOC, "two\n", "manual");

    await vi.waitFor(() => expect(createSnapshot).toHaveBeenCalledTimes(1));
    expect(statefulFs.read(DOC)).toBe("one\n");
    expect(firstDone).toBe(false);

    await vi.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT_MS);
    expect(await first).toBe(true);
    await vi.waitFor(() => expect(createSnapshot).toHaveBeenCalledTimes(2));
    expect(statefulFs.read(DOC)).toBe("two\n");

    await vi.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT_MS);
    expect(await second).toBe(true);
  });
});
