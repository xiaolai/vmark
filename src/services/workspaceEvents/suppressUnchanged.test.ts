// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createContentHashCache, hashContent } from "./contentHashCache";
import { suppressUnchanged, type SuppressDeps } from "./suppressUnchanged";
import type { SemanticWorkspaceEvent } from "./types";

const mod = (path: string): SemanticWorkspaceEvent => ({
  kind: "modified",
  path,
  rootPath: "/ws",
  selfWrite: false,
});

function deps(over: Partial<SuppressDeps> = {}): SuppressDeps {
  return {
    cache: createContentHashCache(),
    readText: async () => "content",
    hash: hashContent,
    isMedia: () => false,
    ...over,
  };
}

describe("suppressUnchanged", () => {
  it("keeps the first change for a path (no baseline) and records it", async () => {
    const d = deps();
    const out = await suppressUnchanged([mod("/ws/a")], d);
    expect(out).toHaveLength(1);
    expect(d.cache.get("/ws/a")).toBeDefined();
  });

  it("suppresses a repeat whose content is identical (no-op touch)", async () => {
    const d = deps({ readText: async () => "same" });
    await suppressUnchanged([mod("/ws/a")], d); // baseline
    expect(await suppressUnchanged([mod("/ws/a")], d)).toEqual([]);
  });

  it("keeps a change whose content actually differs, and re-baselines", async () => {
    let content = "v1";
    const d = deps({ readText: async () => content });
    await suppressUnchanged([mod("/ws/a")], d);
    content = "v2";
    expect(await suppressUnchanged([mod("/ws/a")], d)).toHaveLength(1);
    content = "v2";
    expect(await suppressUnchanged([mod("/ws/a")], d)).toEqual([]); // v2 now baseline
  });

  it("keeps media events without reading them", async () => {
    const readText = vi.fn(async () => "x");
    const out = await suppressUnchanged([mod("/ws/pic.png")], deps({ readText, isMedia: () => true }));
    expect(out).toHaveLength(1);
    expect(readText).not.toHaveBeenCalled();
  });

  it("keeps an event when the file cannot be read, and forgets any baseline", async () => {
    const cache = createContentHashCache();
    await suppressUnchanged([mod("/ws/a")], deps({ cache, readText: async () => "seed" }));
    expect(cache.get("/ws/a")).toBeDefined();

    const out = await suppressUnchanged(
      [mod("/ws/a")],
      deps({
        cache,
        readText: async () => {
          throw new Error("gone");
        },
      }),
    );
    expect(out).toHaveLength(1);
    expect(cache.get("/ws/a")).toBeUndefined();
  });

  it("keeps a delete and forgets its cached hash", async () => {
    const d = deps();
    await suppressUnchanged([mod("/ws/a")], d);
    const out = await suppressUnchanged(
      [{ kind: "deleted", path: "/ws/a", rootPath: "/ws", selfWrite: false }],
      d,
    );
    expect(out).toHaveLength(1);
    expect(d.cache.get("/ws/a")).toBeUndefined();
  });

  it("keeps a rename, moving the baseline old→new so later no-ops suppress", async () => {
    const d = deps({ readText: async () => "same" });
    await suppressUnchanged([mod("/ws/old")], d); // baseline on old
    const renamed: SemanticWorkspaceEvent = {
      kind: "renamed",
      path: "/ws/new",
      previousPath: "/ws/old",
      rootPath: "/ws",
      selfWrite: false,
    };
    expect(await suppressUnchanged([renamed], d)).toHaveLength(1);
    expect(d.cache.get("/ws/old")).toBeUndefined();
    expect(d.cache.get("/ws/new")).toBeDefined();
    expect(await suppressUnchanged([mod("/ws/new")], d)).toEqual([]);
  });

  it("preserves order across a mixed batch", async () => {
    const d = deps({ readText: async () => "x" });
    const out = await suppressUnchanged([mod("/ws/a"), mod("/ws/b")], d);
    expect(out.map((e) => e.path)).toEqual(["/ws/a", "/ws/b"]);
  });
});
