// @vitest-environment node
// A save names when it was asked for, on a clock every document and every
// window shares, and an older save that Rust refuses as superseded — a save
// asked for after it already reached that file — wrote nothing: it reports
// failure without a toast and leaves the newer save's state alone. The case:
// a save through a symlink (its own queue, the path spelling differs) lands
// after a newer save onto the referent, from the same document or from the
// same file reopened. Edge cases: the wall clock stepping back, a refusal
// naming a newer time than this clock has reached, the close flow's answer
// when the newer save already saved the document (and when it did not, when
// its answer arrives after the refusal, when the document differs from its
// file), the MCP door's outcome, CJK.
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
import { imeToast } from "@/services/ime/imeToast";
import { useDocumentStore } from "@/stores/documentStore";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { saveToPath, saveToPathForClose, saveToPathForMcp } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { forgetSaveTarget, resetSaveTargetClaims } from "./saveTargetClaim";

const REAL = `${ROOT}/笔记.md`;
const LINK = `${ROOT}/link.md`;
const OTHER = `${ROOT}/other.md`;

interface Order { seq: number }

function superseded(path: string, newest: number) {
  return { code: "conflict", message: `newer save reached ${path}`, detail: { kind: "superseded", path, newest, recorded: true } };
}

/**
 * Writes wait to be released; a released write is judged as Rust judges it
 * under the file's lock: `LINK` and `REAL` are one file, and a save older
 * than one already published there is refused.
 */
function holdWrites() {
  const disk = new Map<string, string>();
  const published = new Map<string, number>();
  const held: Array<{ args: Record<string, unknown>; publish: () => () => void }> = [];
  statefulFs.stubCommand("atomic_write_file", (args) =>
    new Promise<void>((resolve, reject) => {
      held.push({
        args,
        // Judge and publish now; the returned call delivers the answer.
        publish: () => {
          const file = args.path === LINK ? REAL : String(args.path);
          const seq = (args.order as Order).seq;
          const newest = published.get(file) ?? 0;
          if (newest >= seq) return () => reject(superseded(String(args.path), newest));
          disk.set(file, String(args.content));
          published.set(file, seq);
          return () => resolve();
        },
      });
    }),
  );
  const orders = () => held.map((h) => h.args.order as Order);
  return {
    disk,
    held,
    orders,
    release: (i: number) => held[i].publish()(),
    publishOnly: (i: number) => held[i].publish(),
  };
}

function spyOnToasts() {
  return {
    error: vi.spyOn(imeToast, "error").mockImplementation(() => "id"),
    errorDetail: vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "id"),
  };
}

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  statefulFs.stubCommand("coherence_capture", () => null);
  statefulFs.stubCommand("coherence_head", () => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("every save names when it was asked for", () => {
  it("on the wall clock, increasing across saves and documents", async () => {
    const one = await openDocInTab(REAL, "a\n");
    const two = await openDocInTab(OTHER, "b\n");
    const writes = holdWrites();
    const before = Date.now() * 1000;
    void saveToPath(one, LINK, "a1\n", "auto");
    void saveToPath(two, OTHER, "b1\n");
    void saveToPath(one, REAL, "a2\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(3));

    const [a, b, c] = writes.orders();
    expect(Object.keys(a)).toEqual(["seq"]);
    expect(a.seq).toBeGreaterThanOrEqual(before);
    expect(a.seq).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(c.seq).toBeGreaterThan(b.seq);
  });

  it("still increases when the wall clock steps back", async () => {
    const tabId = await openDocInTab(REAL, "a\n");
    const writes = holdWrites();
    const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
    void saveToPath(tabId, REAL, "a1\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(1));
    now.mockReturnValue(1_999_999_000_000);
    void saveToPath(tabId, OTHER, "a2\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(2));

    const [a, b] = writes.orders();
    expect(a.seq).toBe(2_000_000_000_000_000);
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it("moves past a newer time a refusal names, so the next save is not refused again", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const ahead = Date.now() * 1000 + 3_600_000_000;
    statefulFs.stubCommand("atomic_write_file", () => Promise.reject(superseded(REAL, ahead)));
    editDoc(tabId, "one\n");
    expect(await saveToPath(tabId, REAL, "one\n", "auto")).toBe(false);

    const writes = holdWrites();
    void saveToPath(tabId, REAL, "two\n", "auto");
    await vi.waitFor(() => expect(writes.held).toHaveLength(1));
    expect(writes.orders()[0].seq).toBeGreaterThan(ahead);
  });

  it("ignores a refusal naming a time it could not have issued", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    statefulFs.stubCommand("atomic_write_file", () =>
      Promise.reject(superseded(REAL, Number.MAX_SAFE_INTEGER + 2)),
    );
    editDoc(tabId, "one\n");
    await saveToPath(tabId, REAL, "one\n", "auto");

    const writes = holdWrites();
    void saveToPath(tabId, REAL, "two\n", "auto");
    await vi.waitFor(() => expect(writes.held).toHaveLength(1));
    expect(writes.orders()[0].seq).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});

describe("an older save landing after a newer one", () => {
  it("writes nothing, without a toast, and the close flow sees the document saved", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const toasts = spyOnToasts();
    const writes = holdWrites();
    editDoc(tabId, "one\n");
    const older = saveToPathForClose(tabId, LINK, "one\n");
    editDoc(tabId, "two\n");
    const newer = saveToPath(tabId, REAL, "two\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(2));

    writes.release(1);
    expect(await newer).toBe(true);
    writes.release(0);
    // The document is saved — by the newer save — so a close may proceed.
    expect(await older).toBe(true);

    expect(writes.disk.get(REAL)).toBe("two\n");
    expect(doc(tabId)).toMatchObject({ filePath: REAL, isDirty: false, isMissing: false });
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.errorDetail).not.toHaveBeenCalled();
  });

  it("counts for a close once the newer save, already on disk, finishes recording itself", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const writes = holdWrites();
    editDoc(tabId, "one\n");
    const older = saveToPathForClose(tabId, LINK, "one\n");
    editDoc(tabId, "two\n");
    const newer = saveToPath(tabId, REAL, "two\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(2));

    // Rust published the newer save, but its answer reaches the webview
    // only after the older save's refusal has.
    const answerNewer = writes.publishOnly(1);
    writes.release(0);
    await new Promise((r) => setTimeout(r, 0));
    answerNewer();

    expect(await newer).toBe(true);
    expect(await older).toBe(true);
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("does not count for a close when the document differs from its file", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    statefulFs.stubCommand("atomic_write_file", (args) => Promise.reject(superseded(String(args.path), 1)));
    useDocumentStore.getState().markDivergent(tabId);
    expect(doc(tabId)).toMatchObject({ isDirty: false, isDivergent: true });

    expect(await saveToPathForClose(tabId, LINK, "zero\n")).toBe(false);
  });

  it("reports not written to a save that needs its path, though the document is clean", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const writes = holdWrites();
    const older = saveToPath(tabId, LINK, "one\n");
    const newer = saveToPath(tabId, REAL, "zero\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(2));

    writes.release(1);
    await newer;
    writes.release(0);

    expect(doc(tabId).isDirty).toBe(false);
    expect(await older).toBe(false);
  });

  it("reports not saved to a close when the document changed after the newer save", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    const writes = holdWrites();
    editDoc(tabId, "one\n");
    const older = saveToPathForClose(tabId, LINK, "one\n");
    editDoc(tabId, "two\n");
    const newer = saveToPath(tabId, REAL, "two\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(2));

    writes.release(1);
    await newer;
    editDoc(tabId, "three\n");
    writes.release(0);

    expect(await older).toBe(false);
    expect(writes.disk.get(REAL)).toBe("two\n");
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("is refused when it outlived its document and the file was reopened and saved", async () => {
    const first = await openDocInTab(REAL, "zero\n");
    const writes = holdWrites();
    const older = saveToPath(first, LINK, "old\n", "auto");
    await vi.waitFor(() => expect(writes.held).toHaveLength(1));
    forgetSaveTarget(first);

    const reopened = await openDocInTab(REAL, "zero\n");
    const newer = saveToPath(reopened, REAL, "new\n");
    await vi.waitFor(() => expect(writes.held).toHaveLength(2));
    writes.release(1);
    expect(await newer).toBe(true);
    writes.release(0);
    await older;

    expect(writes.disk.get(REAL)).toBe("new\n");
  });

  it("tells the MCP door it was superseded, naming the path it asked for", async () => {
    const tabId = await openDocInTab(REAL, "zero\n");
    statefulFs.stubCommand("atomic_write_file", (args) => Promise.reject(superseded(String(args.path), 1)));

    const outcome = await saveToPathForMcp(tabId, LINK, "one\n", "workspace.save", TEST_ATTRIBUTION);

    expect(outcome).toMatchObject({ ok: false, reason: "superseded", path: LINK });
    expect(doc(tabId).isMissing).toBe(false);
  });
});
