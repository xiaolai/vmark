// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizeFsEvents, type NormalizeDeps } from "./normalizeFsEvents";
import type { RawFsChangeEvent } from "./types";

const ROOT = "/ws";
const WIN = "main";

function deps(over: Partial<NormalizeDeps> = {}): NormalizeDeps {
  return {
    windowLabel: WIN,
    rootPath: ROOT,
    normalizePath: (p) => p,
    hasPendingSave: () => false,
    ...over,
  };
}

function raw(over: Partial<RawFsChangeEvent> = {}): RawFsChangeEvent {
  return { watchId: WIN, rootPath: ROOT, paths: [`${ROOT}/a.md`], kind: "modify", ...over };
}

describe("normalizeFsEvents", () => {
  it("drops events from another window (watchId mismatch)", () => {
    expect(normalizeFsEvents(raw({ watchId: "other" }), deps())).toEqual([]);
  });

  it("drops events when not in workspace mode (null root)", () => {
    expect(normalizeFsEvents(raw(), deps({ rootPath: null }))).toEqual([]);
  });

  it("drops events with no paths", () => {
    expect(normalizeFsEvents(raw({ paths: [] }), deps())).toEqual([]);
  });

  it.each([
    ["create", "created"],
    ["modify", "modified"],
    ["remove", "deleted"],
    ["rename", "renamed"],
  ])("classifies raw kind %s as %s", (rawKind, expected) => {
    const [evt] = normalizeFsEvents(raw({ kind: rawKind }), deps());
    expect(evt.kind).toBe(expected);
  });

  it("treats an unknown kind as modified (never drops a real edit)", () => {
    const [evt] = normalizeFsEvents(raw({ kind: "weird" }), deps());
    expect(evt.kind).toBe("modified");
  });

  it("scopes out paths outside the workspace root (boundary-safe)", () => {
    const evts = normalizeFsEvents(
      raw({ paths: [`${ROOT}/in.md`, "/wsother/out.md", "/elsewhere.md"] }),
      deps(),
    );
    expect(evts.map((e) => e.path)).toEqual([`${ROOT}/in.md`]);
  });

  it("includes the root itself as in-scope", () => {
    const [evt] = normalizeFsEvents(raw({ paths: [ROOT] }), deps());
    expect(evt.path).toBe(ROOT);
  });

  it("flags self-writes via hasPendingSave", () => {
    const [evt] = normalizeFsEvents(
      raw({ paths: [`${ROOT}/a.md`] }),
      deps({ hasPendingSave: (p) => p === `${ROOT}/a.md` }),
    );
    expect(evt.selfWrite).toBe(true);
  });

  it("does not flag an external edit as a self-write", () => {
    const [evt] = normalizeFsEvents(raw(), deps());
    expect(evt.selfWrite).toBe(false);
  });

  it("dedups repeated paths within one event", () => {
    const evts = normalizeFsEvents(raw({ paths: [`${ROOT}/a.md`, `${ROOT}/a.md`] }), deps());
    expect(evts).toHaveLength(1);
  });

  it("normalizes paths (and the root) via the injected normalizer", () => {
    const [evt] = normalizeFsEvents(
      raw({ paths: [`${ROOT}/A.MD`] }),
      deps({ normalizePath: (p) => p.toLowerCase() }),
    );
    expect(evt.path).toBe(`${ROOT.toLowerCase()}/a.md`);
    expect(evt.rootPath).toBe(ROOT.toLowerCase());
  });

  describe("renames (flattened [old, new] pairs)", () => {
    it("emits a renamed event carrying the previous path", () => {
      const [evt] = normalizeFsEvents(
        raw({ kind: "rename", paths: [`${ROOT}/old.md`, `${ROOT}/new.md`] }),
        deps(),
      );
      expect(evt).toMatchObject({
        kind: "renamed",
        path: `${ROOT}/new.md`,
        previousPath: `${ROOT}/old.md`,
      });
    });

    it("keeps a rename out of the workspace (old path in scope) so consumers react", () => {
      const [evt] = normalizeFsEvents(
        raw({ kind: "rename", paths: [`${ROOT}/old.md`, "/elsewhere/new.md"] }),
        deps(),
      );
      expect(evt).toMatchObject({
        kind: "renamed",
        path: "/elsewhere/new.md",
        previousPath: `${ROOT}/old.md`,
      });
    });

    it("drops a rename with both endpoints out of scope", () => {
      const evts = normalizeFsEvents(
        raw({ kind: "rename", paths: ["/a/old.md", "/b/new.md"] }),
        deps(),
      );
      expect(evts).toEqual([]);
    });

    it("emits an unpaired trailing rename path without a previousPath", () => {
      const [evt] = normalizeFsEvents(raw({ kind: "rename", paths: [`${ROOT}/only.md`] }), deps());
      expect(evt).toMatchObject({ kind: "renamed", path: `${ROOT}/only.md` });
      expect(evt.previousPath).toBeUndefined();
    });

    it("handles multiple rename pairs", () => {
      const evts = normalizeFsEvents(
        raw({ kind: "rename", paths: [`${ROOT}/a`, `${ROOT}/b`, `${ROOT}/c`, `${ROOT}/d`] }),
        deps(),
      );
      expect(evts.map((e) => [e.previousPath, e.path])).toEqual([
        [`${ROOT}/a`, `${ROOT}/b`],
        [`${ROOT}/c`, `${ROOT}/d`],
      ]);
    });
  });
});
