// A failed write marks a document missing only when the failure is about THAT
// document's own file: the save's claim must still name the open document, and
// the failed path must be the document's current path. A Save As to a vanished
// folder, or a save that outlived its document, leaves the live document alone.
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
import { ROOT, doc, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { useDocumentStore } from "@/stores/documentStore";
import { saveToPath } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { forgetSaveTarget, resetSaveTargetClaims } from "./saveTargetClaim";

const DOC = `${ROOT}/notes.md`;

function parentMissing(dir: string) {
  return { code: "not-found", message: `folder ${dir} is gone`, detail: { dir } };
}

/** Every write fails because its folder vanished. */
function writesFailParentMissing(): void {
  statefulFs.stubCommand("atomic_write_file", (args) => {
    const path = String(args.path);
    return Promise.reject(parentMissing(path.slice(0, path.lastIndexOf("/"))));
  });
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

describe("a write whose folder vanished", () => {
  it("marks the document missing when it is the document's own file", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    writesFailParentMissing();
    expect(await saveToPath(tabId, DOC, "b\n")).toBe(false);
    expect(doc(tabId).isMissing).toBe(true);
  });

  it("leaves the source document alone when a Save As destination vanished", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    writesFailParentMissing();
    expect(await saveToPath(tabId, `${ROOT}/gone/文档.md`, "a\n")).toBe(false);
    expect(doc(tabId).isMissing).toBe(false);
    expect(doc(tabId).filePath).toBe(DOC);
  });

  it("leaves a reopened document alone when a save of the closed one fails", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    let fail!: () => void;
    statefulFs.stubCommand("atomic_write_file", (args) =>
      new Promise<void>((_resolve, reject) => {
        fail = () => reject(parentMissing(String(args.path).slice(0, String(args.path).lastIndexOf("/"))));
      }));
    const saving = saveToPath(tabId, DOC, "stale\n");
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"));

    useDocumentStore.getState().removeDocument(tabId);
    forgetSaveTarget(tabId);
    useDocumentStore.getState().initDocument(tabId, "fresh\n", DOC);
    fail();

    expect(await saving).toBe(false);
    expect(doc(tabId).isMissing).toBe(false);
  });
});
