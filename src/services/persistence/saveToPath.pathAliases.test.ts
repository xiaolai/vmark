// @vitest-environment node
// Two spellings of one file (`/root/./notes.md`, `/root/notes.md`) are one
// file to the save pipeline: their saves share one queue, a failed write
// through either marks the document missing, and an older save through the
// alias still records the document as saved — under the path it already has.
// Real stores and pipeline over the stateful disk fake.
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
import { saveToPath } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { resetSaveTargetClaims } from "./saveTargetClaim";

const DOC = `${ROOT}/notes.md`;
const ALIAS = `${ROOT}/./sub/../notes.md`;

/** Writes wait to be released one at a time; `started` lists the paths in arrival order. */
function holdWrites() {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  statefulFs.stubCommand("atomic_write_file", (args) => {
    started.push(String(args.path));
    return new Promise<void>((resolve) => releases.push(resolve));
  });
  return { started, releaseNext: () => releases.shift()?.() };
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

describe("saves through two spellings of one file", () => {
  it("run one at a time, in submission order", async () => {
    const tabId = await openDocInTab(DOC, "zero\n");
    const writes = holdWrites();
    editDoc(tabId, "one\n");
    const first = saveToPath(tabId, ALIAS, "one\n");
    editDoc(tabId, "two\n");
    const second = saveToPath(tabId, DOC, "two\n");

    await vi.waitFor(() => expect(writes.started).toEqual([ALIAS]));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes.started).toEqual([ALIAS]);

    writes.releaseNext();
    expect(await first).toBe(true);
    await vi.waitFor(() => expect(writes.started).toEqual([ALIAS, DOC]));
    writes.releaseNext();
    expect(await second).toBe(true);
  });

  it("an older save through the alias records the document saved, keeping its path", async () => {
    const tabId = await openDocInTab(DOC, "zero\n");
    const writes = holdWrites();
    editDoc(tabId, "one\n");
    const first = saveToPath(tabId, ALIAS, "one\n");
    const second = saveToPath(tabId, DOC, "one\n");

    await vi.waitFor(() => expect(writes.started).toHaveLength(1));
    writes.releaseNext();
    expect(await first).toBe(true);
    expect(doc(tabId).isDirty).toBe(false);
    expect(doc(tabId).filePath).toBe(DOC);

    await vi.waitFor(() => expect(writes.started).toHaveLength(2));
    writes.releaseNext();
    expect(await second).toBe(true);
  });

  it("a write through the alias whose folder vanished marks the document missing", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    statefulFs.stubCommand("atomic_write_file", () =>
      Promise.reject({ code: "not-found", message: "folder gone", detail: { dir: ROOT } }));
    expect(await saveToPath(tabId, ALIAS, "b\n")).toBe(false);
    expect(doc(tabId).isMissing).toBe(true);
  });
});
