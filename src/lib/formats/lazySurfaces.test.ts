// WI-13 — format-adapter surfaces resolve through import thunks (D4).
//
// The property under test is a COLD-START property: `bootstrapFormats()` runs
// in every window before `import("./App")`, so anything an adapter reaches
// statically is paid by Settings and PDF-export windows that never open an
// editor. Metadata (extensions, dispatch, path keys) must stay synchronous and
// evaluate ZERO thunks; the heavy surfaces load at first mount.
//
// Rejection semantics are pinned by decision-ledger entry **D4**
// (.claude/tdd-guardian/decisions-20260803.md): a rejected thunk produces a
// typed, observable error surface — never a silent blank editor — and the
// failure is RETRIED on the next mount (fulfilled results are cached; a
// rejection is evicted).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FormatSurfaceLoadError,
  __resetFormatSurfaceCache,
  resolveFormatSurface,
} from "./lazySurfaces";
import { __resetRegistry, dispatchEditor, getFormatById, registerFormat } from "./registry";
import { rebootstrapFormats } from "./registryBootstrap";
import type { FormatConfig } from "./types";
import type { ComponentType } from "react";
import { SURFACE_IMPORT_TEST_TIMEOUT_MS } from "@/test/waitBudget";

/** Deferred promise — lets a test hold a thunk unresolved across two callers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const Surface: ComponentType<{ tabId: string }> = () => null;

/** A minimal registrable config whose surface thunk counts its evaluations. */
function countingConfig(id: string) {
  const calls = { wysiwygComponent: 0, language: 0 };
  const config: FormatConfig = {
    id,
    nameI18nKey: `format.${id}`,
    extensions: [`${id}ext`],
    kind: "wysiwyg",
    wysiwygComponent: () => {
      calls.wysiwygComponent += 1;
      return Promise.resolve({ default: Surface });
    },
    language: () => {
      calls.language += 1;
      return Promise.resolve([]);
    },
    adapters: {
      saveDialogFilters: [{ nameI18nKey: `format.${id}`, extensions: [`${id}ext`] }],
      untitledExtension: `${id}ext`,
      readOnlyDefault: false,
      closeSavePolicy: "prompt-on-close",
      menuPolicy: {
        sourceWysiwygToggle: false,
        cjkFormatActions: false,
        insertBlockActions: false,
        paragraphFormatting: false,
      },
    },
  };
  return { config, calls };
}

beforeEach(() => {
  __resetRegistry();
  __resetFormatSurfaceCache();
});

afterEach(() => {
  __resetRegistry();
  __resetFormatSurfaceCache();
});

// Case 1 — metadata stays synchronous, thunk counter === 0.
describe("registry metadata is synchronous and evaluates no thunk", () => {
  it("registers and dispatches without invoking either surface thunk", () => {
    const { config, calls } = countingConfig("counted");
    registerFormat(config);

    expect(getFormatById("counted")?.kind).toBe("wysiwyg");
    expect(dispatchEditor("/x/doc.countedext").id).toBe("counted");
    expect(getFormatById("counted")?.extensions).toEqual(["countedext"]);
    expect(getFormatById("counted")?.adapters.untitledExtension).toBe("countedext");

    expect(calls).toEqual({ wysiwygComponent: 0, language: 0 });
  });

  it("bootstraps every shipped adapter with surfaces still unresolved", () => {
    // The real bootstrap, the real adapters — the cold-start path itself.
    rebootstrapFormats();

    // Metadata answers come back with no await anywhere.
    expect(dispatchEditor("/x/a.md").id).toBe("markdown");
    expect(dispatchEditor("/x/a.yml").id).toBe("yaml");
    expect(dispatchEditor("/x/a.unknown-ext").id).toBe("txt");
    expect(getFormatById("markdown")?.extensions).toContain("mdx");

    // A surface is a THUNK, not a value: calling it returns a promise, which
    // is what proves the module was not already imported to build the config.
    const markdown = getFormatById("markdown")!;
    expect(typeof markdown.wysiwygComponent).toBe("function");
    expect(markdown.wysiwygComponent!()).toBeInstanceOf(Promise);
    expect(typeof getFormatById("yaml")!.language).toBe("function");
    expect(getFormatById("yaml")!.language!()).toBeInstanceOf(Promise);
  });
});

// Case 2 — the thunk points at the real module.
//
/** These two tests are the heaviest in the app tier by a wide margin: each
 *  really imports `adapters/markdownSurface`, i.e. the whole Tiptap/ProseMirror
 *  module graph, and Vite transforms it inside the test. Measured ALONE on an
 *  idle machine that is ~10.7s, against the suite's ~100ms median — barely 2x
 *  under the global 20s `testTimeout`, and it does not fit at all once 16
 *  workers compete for cores with a cold transform cache, which is how a full
 *  run and every CI shard start.
 *
 *  That ~10.7s measurement is what sizes the whole class, so the constant is
 *  shared rather than declared here: `Editor.test.tsx` waits on the same import
 *  and was flaking on a locally-invented number. One definition, in
 *  `src/test/waitBudget.ts`. */
const SURFACE_IMPORT_TIMEOUT_MS = SURFACE_IMPORT_TEST_TIMEOUT_MS;

describe("surface thunks resolve to the real modules", () => {
  it("markdown's wysiwygComponent thunk yields the markdown surface module export", async () => {
    rebootstrapFormats();
    const markdown = getFormatById("markdown");
    const [viaThunk, direct] = await Promise.all([
      markdown!.wysiwygComponent!(),
      import("./adapters/markdownSurface"),
    ]);
    // Strict identity with the module's own export — a thunk pointing at the
    // wrong module, or mapping the wrong name, both produce a mount that
    // renders nothing rather than throwing.
    expect(viaThunk.default).toBe(direct.MarkdownEditorSurface);
    expect(typeof viaThunk.default).toBe("function");
  }, SURFACE_IMPORT_TIMEOUT_MS);

  it("markdown's language thunk yields a usable CodeMirror extension", async () => {
    rebootstrapFormats();
    const language = await getFormatById("markdown")!.language!();
    expect(language).toBeDefined();
    // An Extension is an array/object tree, never a bare undefined/null.
    expect(language === null || language === undefined).toBe(false);
  }, SURFACE_IMPORT_TIMEOUT_MS);
});

// Case 3 — resolution is cached: two mounts, one evaluation.
describe("resolution cache", () => {
  it("evaluates the thunk once across two mounts and returns the same reference", async () => {
    const { config, calls } = countingConfig("cached");
    registerFormat(config);

    const first = await resolveFormatSurface(config.id, "wysiwygComponent", config.wysiwygComponent!);
    const second = await resolveFormatSurface(config.id, "wysiwygComponent", config.wysiwygComponent!);

    expect(calls.wysiwygComponent).toBe(1);
    expect(second).toBe(first);
  });

  it("caches per (format, surface) — a second surface is not served the first's value", async () => {
    const { config, calls } = countingConfig("twosurface");
    registerFormat(config);

    const component = await resolveFormatSurface(
      config.id,
      "wysiwygComponent",
      config.wysiwygComponent!,
    );
    const language = await resolveFormatSurface(config.id, "language", config.language!);

    expect(calls).toEqual({ wysiwygComponent: 1, language: 1 });
    expect(language).not.toBe(component);
  });

  it("caches per format id — two adapters do not share one entry", async () => {
    const a = countingConfig("adaptera");
    const b = countingConfig("adapterb");
    registerFormat(a.config);
    registerFormat(b.config);

    await resolveFormatSurface(a.config.id, "language", a.config.language!);
    await resolveFormatSurface(b.config.id, "language", b.config.language!);

    expect(a.calls.language).toBe(1);
    expect(b.calls.language).toBe(1);
  });
});

// Case 4 — concurrent first mounts share ONE evaluation (in-flight tracking).
describe("concurrent first mounts", () => {
  it("evaluates once when two mounts overlap and both get the same reference", async () => {
    const gate = deferred<{ default: typeof Surface }>();
    let calls = 0;
    const thunk = () => {
      calls += 1;
      return gate.promise;
    };

    const first = resolveFormatSurface("concurrent", "wysiwygComponent", thunk);
    const second = resolveFormatSurface("concurrent", "wysiwygComponent", thunk);
    // Both callers are in flight BEFORE the module resolves — an
    // `if (!cached)` cache would have evaluated twice by now.
    expect(calls).toBe(1);

    gate.resolve({ default: Surface });
    const [a, b] = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("a mount starting after resolution still gets the cached reference", async () => {
    const gate = deferred<{ default: typeof Surface }>();
    let calls = 0;
    const thunk = () => {
      calls += 1;
      return gate.promise;
    };

    const first = resolveFormatSurface("late", "wysiwygComponent", thunk);
    gate.resolve({ default: Surface });
    const a = await first;
    const b = await resolveFormatSurface("late", "wysiwygComponent", thunk);

    expect(calls).toBe(1);
    expect(b).toBe(a);
  });
});

// Case 5 — rejection: typed error surface + D4 retry-on-next-mount.
describe("thunk rejection (D4)", () => {
  it("rejects with a typed error naming the adapter and the surface", async () => {
    const boom = new Error("chunk 404");
    const thunk = () => Promise.reject(boom);

    await expect(
      resolveFormatSurface("brokenfmt", "wysiwygComponent", thunk),
    ).rejects.toBeInstanceOf(FormatSurfaceLoadError);

    const error = await resolveFormatSurface("brokenfmt", "wysiwygComponent", thunk).catch(
      (e: unknown) => e as FormatSurfaceLoadError,
    );
    expect(error.formatId).toBe("brokenfmt");
    expect(error.surface).toBe("wysiwygComponent");
    expect(error.message).toContain("brokenfmt");
    expect(error.message).toContain("wysiwygComponent");
    expect(error.cause).toBe(boom);
  });

  it("RETRIES on the next mount — a failure is never cached (D4)", async () => {
    let calls = 0;
    const thunk = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("transient"))
        : Promise.resolve({ default: Surface });
    };

    await expect(resolveFormatSurface("flaky", "wysiwygComponent", thunk)).rejects.toBeInstanceOf(
      FormatSurfaceLoadError,
    );
    const recovered = await resolveFormatSurface("flaky", "wysiwygComponent", thunk);

    expect(calls).toBe(2);
    expect(recovered.default).toBe(Surface);
  });

  it("does not re-evaluate after recovery — the success is what gets cached", async () => {
    let calls = 0;
    const thunk = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("transient"))
        : Promise.resolve({ default: Surface });
    };

    await resolveFormatSurface("flaky2", "wysiwygComponent", thunk).catch(() => undefined);
    await resolveFormatSurface("flaky2", "wysiwygComponent", thunk);
    await resolveFormatSurface("flaky2", "wysiwygComponent", thunk);

    expect(calls).toBe(2);
  });

  it("concurrent mounts joined to a failing attempt all see it, and the next attempt is fresh", async () => {
    const gate = deferred<{ default: typeof Surface }>();
    let calls = 0;
    const thunk = () => {
      calls += 1;
      return calls === 1 ? gate.promise : Promise.resolve({ default: Surface });
    };

    const first = resolveFormatSurface("shared", "wysiwygComponent", thunk);
    const second = resolveFormatSurface("shared", "wysiwygComponent", thunk);
    gate.reject(new Error("transient"));

    await expect(first).rejects.toBeInstanceOf(FormatSurfaceLoadError);
    await expect(second).rejects.toBeInstanceOf(FormatSurfaceLoadError);
    expect(calls).toBe(1);

    await expect(
      resolveFormatSurface("shared", "wysiwygComponent", thunk),
    ).resolves.toMatchObject({ default: Surface });
    expect(calls).toBe(2);
  });

  it("a thunk that throws synchronously is surfaced as the same typed rejection", async () => {
    const thunk = vi.fn(() => {
      throw new Error("sync boom");
    }) as unknown as () => Promise<{ default: typeof Surface }>;

    await expect(resolveFormatSurface("syncthrow", "language", thunk)).rejects.toBeInstanceOf(
      FormatSurfaceLoadError,
    );
    // and it is retryable, exactly like an async rejection
    await expect(resolveFormatSurface("syncthrow", "language", thunk)).rejects.toBeInstanceOf(
      FormatSurfaceLoadError,
    );
    expect(thunk).toHaveBeenCalledTimes(2);
  });
});

// Case 6 — registration guard.
describe("registration guard", () => {
  it("rejects a wysiwyg adapter whose surface thunk is missing, naming the adapter", () => {
    const { config } = countingConfig("nosurface");
    expect(() => registerFormat({ ...config, wysiwygComponent: undefined })).toThrowError(
      /nosurface[\s\S]*wysiwygComponent|wysiwygComponent[\s\S]*nosurface/,
    );
  });

  it("rejects a surface that is a value rather than a thunk, naming the adapter", () => {
    const { config } = countingConfig("eagersurface");
    expect(() =>
      registerFormat({
        ...config,
        // The pre-WI-13 shape reduced to what is actually detectable at
        // registration: a non-function. A thunk cannot be told from a
        // component by inspection (both are functions) and calling it here
        // would defeat the whole point, so the guard checks the one thing it
        // can: the field is callable.
        wysiwygComponent: { default: Surface } as unknown as FormatConfig["wysiwygComponent"],
      }),
    ).toThrowError(/eagersurface/);
  });

  it("rejects a non-thunk language on any kind, naming the adapter", () => {
    const { config } = countingConfig("eagerlang");
    expect(() =>
      registerFormat({
        ...config,
        language: [] as unknown as FormatConfig["language"],
      }),
    ).toThrowError(/eagerlang/);
  });

  it("accepts a well-formed adapter", () => {
    const { config } = countingConfig("wellformed");
    expect(() => registerFormat(config)).not.toThrow();
  });
});
