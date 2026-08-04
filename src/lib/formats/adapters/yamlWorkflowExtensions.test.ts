/**
 * Audit 20260804-F8 — a failed GHA source-extension chunk degrades, loudly.
 *
 * The four extensions used to share one `Promise.all`, so ONE failed dynamic
 * import rejected `loadExtraExtensions` wholesale: the user lost expression
 * completion, cursor↔canvas sync AND goto-def together, with nothing logged.
 * And because all three are no-ops until the document is a workflow, the
 * symptom ("completion does nothing here") is indistinguishable from normal
 * operation — there was no way to tell a broken editor from a quiet one.
 *
 * Mock boundary: the chunk LOADERS, injected through the function's own
 * parameter, plus the warn logger. Faking them through the module registry
 * does not work — vitest caches a module once it resolves, so a chunk that
 * succeeded in one case can never be made to fail in the next. The last test
 * runs the REAL production loaders so the default path is not left unproven.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatsWarn: (...args: unknown[]) => mocks.warn(...args),
}));

import {
  __resetWorkflowExtensionReports,
  loadWorkflowSourceExtensions,
  type WorkflowExtensionLoaders,
} from "./yamlWorkflowExtensions";

const ctx = { tabId: "tab-1", filePath: "/repo/.github/workflows/ci.yml", windowLabel: "main" };

const CHUNK_ERROR = () =>
  Promise.reject(new Error("Failed to fetch dynamically imported module"));

/** Fake loaders; any key listed in `failing` rejects like a missing chunk. */
function loadersWith(failing: Array<keyof WorkflowExtensionLoaders> = []) {
  const ok = {
    irSync: () => Promise.resolve({ ghaIrSyncExtension: () => ({ id: "ir-sync" }) }),
    completion: () => Promise.resolve({ workflowCompletionExtension: () => ({ id: "completion" }) }),
    cursorSync: () =>
      Promise.resolve({ workflowCursorSyncExtension: () => ({ id: "cursor-sync" }) }),
    goto: () => Promise.resolve({ gotoExtension: () => ({ id: "goto" }) }),
  };
  for (const key of failing) ok[key] = CHUNK_ERROR as never;
  return ok as unknown as WorkflowExtensionLoaders;
}

/** Ids of the extensions that made it into the returned list. */
function idsOf(extensions: unknown[]): string[] {
  return extensions.map((e) => (e as { id?: string }).id ?? "?");
}

beforeEach(() => {
  mocks.warn.mockReset();
  __resetWorkflowExtensionReports();
});

describe("loadWorkflowSourceExtensions — one bad chunk costs one feature", () => {
  it("returns all four in adapter order when every chunk loads", async () => {
    const extensions = await loadWorkflowSourceExtensions(ctx, loadersWith());

    expect(idsOf(extensions)).toEqual(["ir-sync", "completion", "cursor-sync", "goto"]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("keeps the other three when completion fails", async () => {
    const extensions = await loadWorkflowSourceExtensions(ctx, loadersWith(["completion"]));

    expect(idsOf(extensions)).toEqual(["ir-sync", "cursor-sync", "goto"]);
  });

  it("names the failed extension and says the editor continues", async () => {
    await loadWorkflowSourceExtensions(ctx, loadersWith(["completion"]));

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    const message = String(mocks.warn.mock.calls[0][0]);
    expect(message).toContain("workflow-completion");
    expect(message).toMatch(/continues without it/i);
  });

  it("reports each failed extension ONCE, however many tabs open", async () => {
    const loaders = loadersWith(["cursorSync"]);

    await loadWorkflowSourceExtensions(ctx, loaders);
    await loadWorkflowSourceExtensions({ ...ctx, tabId: "tab-2" }, loaders);
    await loadWorkflowSourceExtensions({ ...ctx, tabId: "tab-3" }, loaders);

    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("reports each failure separately when several chunks fail", async () => {
    const extensions = await loadWorkflowSourceExtensions(
      ctx,
      loadersWith(["irSync", "goto"]),
    );

    expect(idsOf(extensions)).toEqual(["completion", "cursor-sync"]);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    const names = mocks.warn.mock.calls.map((c) => String(c[0]));
    expect(names.some((m) => m.includes("gha-ir-sync"))).toBe(true);
    expect(names.some((m) => m.includes("workflow-goto"))).toBe(true);
  });

  it("resolves to an empty list — never rejects — when every chunk fails", async () => {
    // The editor still mounts: highlighting, lint and editing come from
    // elsewhere. Rejecting here is what used to take the whole set down.
    const loaders = loadersWith(["irSync", "completion", "cursorSync", "goto"]);

    await expect(loadWorkflowSourceExtensions(ctx, loaders)).resolves.toEqual([]);
    expect(mocks.warn).toHaveBeenCalledTimes(4);
  });

  it("skips goto-def without a file path, and does not warn about it", async () => {
    const extensions = await loadWorkflowSourceExtensions(
      { ...ctx, filePath: null },
      loadersWith(["goto"]),
    );

    expect(idsOf(extensions)).toEqual(["ir-sync", "completion", "cursor-sync"]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("loads the REAL chunks through the production default", async () => {
    // The seam must not become the only thing that works: with no loaders
    // argument the function does the actual dynamic imports the adapter ships.
    const extensions = await loadWorkflowSourceExtensions(ctx);

    expect(extensions).toHaveLength(4);
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
