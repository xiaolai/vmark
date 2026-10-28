// @vitest-environment node
// A close whose save was refused as superseded waits only for the saves of
// its document asked for after it — the ones that can have saved it — and
// only for a bounded time, so a save that never answers cannot hold a close
// or a quit forever. A refusal counts only when the save that refused it is
// one of this document's own: a save from another window or document may
// have left the file holding text this document never had. Edge cases: an
// older save of the document that never answers, a newer one that never
// answers, a newer one that answers, a newer save from elsewhere while the
// document reads clean, a refusal by the floor naming one of the document's
// own saves to another file, an edit landing while its close save was in
// flight (reported written, left dirty for the close loop), the tab reopened
// on another document meanwhile, CJK.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, doc, editDoc, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { saveToPath, saveToPathForClose } from "./saveToPath";
import { CLOSE_WAIT_MS } from "./saveInFlight";
import { __resetSerializer } from "./serializeByPath";
import { forgetSaveTarget, resetSaveTargetClaims } from "./saveTargetClaim";
import { useDocumentStore } from "@/stores/documentStore";

const REAL = `${ROOT}/笔记.md`;
const LINK = `${ROOT}/link.md`;
const STUCK = `${ROOT}/stuck.md`;

/**
 * A write to `STUCK` never answers. `LINK` and `REAL` are one file: a held
 * write, once published, is judged as Rust judges it; the call it returns
 * delivers the answer.
 */
function writes() {
  const published = { seq: 0 };
  const held: Array<() => () => void> = [];
  statefulFs.stubCommand("atomic_write_file", (args) => {
    if (args.path === STUCK) return new Promise<void>(() => {});
    return new Promise<void>((resolve, reject) => {
      held.push(() => {
        const seq = (args.order as { seq: number }).seq;
        const newest = published.seq;
        if (newest >= seq) {
          return () =>
            reject({ code: "conflict", message: "superseded", detail: { kind: "superseded", path: args.path, newest, recorded: true } });
        }
        published.seq = seq;
        return () => resolve();
      });
    });
  });
  return held;
}

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  statefulFs.stubCommand("coherence_capture", () => null);
  statefulFs.stubCommand("coherence_head", () => null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a close refused as superseded", () => {
  it("does not wait for an older save of the document that never answers", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const held = writes();
    vi.useFakeTimers();
    void saveToPath(tabId, STUCK, "zero\n");
    editDoc(tabId, "one\n");
    const close = saveToPathForClose(tabId, LINK, "one\n");
    editDoc(tabId, "two\n");
    const newer = saveToPath(tabId, REAL, "two\n");
    await vi.waitFor(() => expect(held).toHaveLength(2));

    // The newer save is on disk, but its answer arrives after the refusal.
    const answerNewer = held[1]();
    held[0]()();
    await vi.advanceTimersByTimeAsync(0);
    answerNewer();
    expect(await newer).toBe(true);
    expect(await close).toBe(true);
  });

  it("gives up on a newer save that never answers, and reports not saved", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    // Published by a save from elsewhere: this close is refused.
    statefulFs.stubCommand("atomic_write_file", (args) =>
      args.path === STUCK
        ? new Promise<void>(() => {})
        : Promise.reject({ code: "conflict", message: "superseded", detail: { kind: "superseded", path: args.path, newest: 1 } }),
    );
    editDoc(tabId, "one\n");
    vi.useFakeTimers();
    const close = saveToPathForClose(tabId, LINK, "one\n");
    void saveToPath(tabId, STUCK, "one\n");
    let settled: boolean | undefined;
    void close.then((v) => (settled = v));

    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("does not count a refusal by a save from elsewhere, though the document reads clean", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const elsewhere = Date.now() * 1000 + 3_600_000_000;
    statefulFs.stubCommand("atomic_write_file", (args) =>
      Promise.reject({ code: "conflict", message: "superseded", detail: { kind: "superseded", path: args.path, newest: elsewhere } }),
    );
    expect(doc(tabId)).toMatchObject({ isDirty: false, isDivergent: false });

    expect(await saveToPathForClose(tabId, LINK, "zero\n")).toBe(false);
  });

  it("does not count a refusal by the floor, though it names the document's own save", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    let own = 0;
    statefulFs.stubCommand("atomic_write_file", (args) => {
      own = (args.order as { seq: number }).seq;
      return Promise.resolve();
    });
    expect(await saveToPath(tabId, `${ROOT}/elsewhere.md`, "zero\n")).toBe(true);
    statefulFs.stubCommand("atomic_write_file", (args) =>
      Promise.reject({ code: "conflict", message: "superseded", detail: { kind: "superseded", path: args.path, newest: own, recorded: false } }),
    );

    expect(await saveToPathForClose(tabId, LINK, "zero\n")).toBe(false);
  });

  it("reports the write, and leaves an edit made during it dirty for the close loop", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const held = writes();
    editDoc(tabId, "one\n");
    const close = saveToPathForClose(tabId, REAL, "one\n");
    await vi.waitFor(() => expect(held).toHaveLength(1));
    editDoc(tabId, "two\n");
    held[0]()();

    expect(await close).toBe(true);
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("does not report saved for a document reopened under the tab while its close save was in flight", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const held = writes();
    editDoc(tabId, "one\n");
    const close = saveToPathForClose(tabId, REAL, "one\n");
    await vi.waitFor(() => expect(held).toHaveLength(1));
    useDocumentStore.getState().removeDocument(tabId);
    forgetSaveTarget(tabId);
    useDocumentStore.getState().initDocument(tabId, "other\n", `${ROOT}/other.md`);
    held[0]()();

    expect(await close).toBe(false);
  });
});
