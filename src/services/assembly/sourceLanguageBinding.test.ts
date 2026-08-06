// WI-13 — the source editor's language pack, bound through an import thunk.
//
// `FormatConfig.language` used to be synchronous, which forced the markdown
// adapter to statically import the CodeMirror pack — and the adapter is
// evaluated by `bootstrapFormats()` in every window before App, so that import
// was cold-start cost for Settings and PDF-export windows with no editor in
// them. It is a thunk now, so the binding is async.
//
// What must not regress is the reason the field was synchronous in the first
// place: the primary format must never paint an unhighlighted frame. That is
// why the compartment mounts with the markdown pack and the resolved pack is
// swapped in afterwards, and why the resolution failing has to leave the
// fallback standing rather than blanking the highlighting.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const mocks = vi.hoisted(() => ({ formatsWarn: vi.fn() }));

// Partial mock: only the logger this module reports through is replaced, so
// every other consumer in the graph keeps the real one.
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatsWarn: (...args: unknown[]) => mocks.formatsWarn(...args),
}));

import {
  __resetLanguageFailureReports,
  formatLanguageExtension,
  loadFormatLanguage,
} from "./sourceLanguageBinding";
import { __resetRegistry, registerFormat } from "@/lib/formats/registry";
import { __resetFormatSurfaceCache } from "@/lib/formats/lazySurfaces";
import { rebootstrapFormats } from "@/lib/formats/registryBootstrap";
import type { FormatConfig } from "@/lib/formats/types";

const marker = { __marker: "resolved-language" } as unknown;

function splitPaneConfig(id: string, overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    id,
    nameI18nKey: `format.${id}`,
    extensions: [id],
    kind: "split-pane",
    adapters: {
      saveDialogFilters: [{ nameI18nKey: `format.${id}`, extensions: [id] }],
      untitledExtension: id,
      readOnlyDefault: false,
      closeSavePolicy: "prompt-on-close",
      menuPolicy: {
        sourceWysiwygToggle: false,
        cjkFormatActions: false,
        insertBlockActions: false,
        paragraphFormatting: false,
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  __resetRegistry();
  __resetFormatSurfaceCache();
  __resetLanguageFailureReports();
  mocks.formatsWarn.mockReset();
});
afterEach(() => {
  __resetRegistry();
  __resetFormatSurfaceCache();
  __resetLanguageFailureReports();
});

describe("loadFormatLanguage", () => {
  it("resolves the pack the dispatched format's thunk returns", async () => {
    registerFormat(
      splitPaneConfig("marked", { language: () => Promise.resolve(marker as never) }),
    );

    await expect(loadFormatLanguage("/x/doc.marked")).resolves.toBe(marker);
  });

  it("returns null when the format declares no language pack", async () => {
    // Null means "keep the markdown fallback already in the compartment" —
    // NOT "clear the highlighting".
    registerFormat(splitPaneConfig("nolang"));

    await expect(loadFormatLanguage("/x/doc.nolang")).resolves.toBeNull();
  });

  it("returns null instead of throwing when the thunk rejects", async () => {
    registerFormat(
      splitPaneConfig("brokenlang", {
        language: () => Promise.reject(new Error("chunk 404")),
      }),
    );

    // A source editor with imperfect highlighting is recoverable; one that
    // throws out of its mount effect is not.
    await expect(loadFormatLanguage("/x/doc.brokenlang")).resolves.toBeNull();
  });

  it("returns null instead of throwing when no format is registered at all", async () => {
    // `dispatchEditor` throws on an empty registry, which is the state unit
    // tests that build extensions without bootstrapping run in.
    await expect(loadFormatLanguage("/x/doc.md")).resolves.toBeNull();
  });

  it("dispatches on the path, so two paths get two different packs", async () => {
    const a = {} as never;
    const b = {} as never;
    registerFormat(splitPaneConfig("aaa", { language: () => Promise.resolve(a) }));
    registerFormat(splitPaneConfig("bbb", { language: () => Promise.resolve(b) }));

    await expect(loadFormatLanguage("/x/doc.aaa")).resolves.toBe(a);
    await expect(loadFormatLanguage("/x/doc.bbb")).resolves.toBe(b);
  });

  it("treats a null path as the untitled document — markdown", async () => {
    rebootstrapFormats();

    const language = await loadFormatLanguage(null);

    // Markdown IS the untitled default, so an untitled buffer must get the
    // markdown pack rather than falling through to "no pack".
    expect(language).not.toBeNull();
  });

  it("resolves markdown's real pack for a .md path", async () => {
    rebootstrapFormats();

    await expect(loadFormatLanguage("/x/notes.md")).resolves.not.toBeNull();
  });
});

/**
 * Audit 20260804-F6 — production resolution must go through the SHARED cache.
 *
 * `lib/formats/lazySurfaces.ts` exists to make "one evaluation per format"
 * true, and `FormatSurface` uses it — but this binding called the thunk
 * directly, so the cache guarded only the WYSIWYG path. On the source path
 * every mount rebuilt the CodeMirror pack (markdown's pulls
 * `@codemirror/language-data`, ~140 language loaders) and two concurrent
 * mounts could end up holding two different module instances.
 */
describe("thunk resolution goes through the shared cache", () => {
  it("evaluates the thunk ONCE across two sequential loads", async () => {
    const thunk = vi.fn(() => Promise.resolve(marker as never));
    registerFormat(splitPaneConfig("cachedlang", { language: thunk }));

    const first = await loadFormatLanguage("/x/a.cachedlang");
    const second = await loadFormatLanguage("/x/b.cachedlang");

    expect(thunk).toHaveBeenCalledTimes(1);
    // Same reference, not merely an equal value: two evaluations would hand
    // back two module instances.
    expect(second).toBe(first);
  });

  it("evaluates the thunk ONCE for two loads started in the same tick", async () => {
    const thunk = vi.fn(
      () => new Promise<never>((resolve) => setTimeout(() => resolve(marker as never), 0)),
    );
    registerFormat(splitPaneConfig("racecache", { language: thunk }));

    const [a, b] = await Promise.all([
      loadFormatLanguage("/x/a.racecache"),
      loadFormatLanguage("/x/b.racecache"),
    ]);

    expect(thunk).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("evaluates the thunk ONCE across two mounted views", async () => {
    // The integration shape the bug actually took: two panes on the same
    // format, each constructing the extension.
    const thunk = vi.fn(() =>
      Promise.resolve(EditorState.tabSize.of(7) as never),
    );
    registerFormat(splitPaneConfig("twoviews", { language: thunk }));

    const views = ["/x/a.twoviews", "/x/b.twoviews"].map(
      (p) =>
        new EditorView({
          state: EditorState.create({ doc: "hi", extensions: formatLanguageExtension(p) }),
        }),
    );
    try {
      await vi.waitFor(() => {
        for (const v of views) expect(v.state.tabSize).toBe(7);
      });
      expect(thunk).toHaveBeenCalledTimes(1);
    } finally {
      for (const v of views) v.destroy();
    }
  });

  it("retries a REJECTED thunk on the next load — failures are not cached", async () => {
    let attempt = 0;
    const thunk = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("chunk 404"))
        : Promise.resolve(marker as never);
    });
    registerFormat(splitPaneConfig("flakylang", { language: thunk }));

    await expect(loadFormatLanguage("/x/a.flakylang")).resolves.toBeNull();
    await expect(loadFormatLanguage("/x/a.flakylang")).resolves.toBe(marker);
    expect(thunk).toHaveBeenCalledTimes(2);
  });
});

/**
 * Audit 20260804-F14 — a rejection and "nothing registered" both return null,
 * but they are not the same event. The rejection is a malfunction whose only
 * other symptom is wrong syntax highlighting; collapsing it into the silent
 * null left nothing to diagnose from.
 */
describe("null is not one thing — the rejection is reported", () => {
  it("warns when the thunk rejects", async () => {
    registerFormat(
      splitPaneConfig("noisylang", { language: () => Promise.reject(new Error("chunk 404")) }),
    );

    await expect(loadFormatLanguage("/x/doc.noisylang")).resolves.toBeNull();

    expect(mocks.formatsWarn).toHaveBeenCalledTimes(1);
    expect(String(mocks.formatsWarn.mock.calls[0][0])).toContain("noisylang");
  });

  it("warns ONCE per format, however many views mount", async () => {
    registerFormat(
      splitPaneConfig("repeatlang", { language: () => Promise.reject(new Error("chunk 404")) }),
    );

    await loadFormatLanguage("/x/a.repeatlang");
    await loadFormatLanguage("/x/b.repeatlang");
    await loadFormatLanguage("/x/c.repeatlang");

    expect(mocks.formatsWarn).toHaveBeenCalledTimes(1);
  });

  it("stays SILENT when the format simply declares no pack", async () => {
    registerFormat(splitPaneConfig("quietlang"));

    await expect(loadFormatLanguage("/x/doc.quietlang")).resolves.toBeNull();
    expect(mocks.formatsWarn).not.toHaveBeenCalled();
  });

  it("stays SILENT when no format is registered at all", async () => {
    // An empty registry is a normal state for unit tests that build extensions
    // without bootstrapping — warning here would train the reader to ignore it.
    await expect(loadFormatLanguage("/x/doc.md")).resolves.toBeNull();
    expect(mocks.formatsWarn).not.toHaveBeenCalled();
  });

  it("stays SILENT on the success path", async () => {
    registerFormat(
      splitPaneConfig("finelang", { language: () => Promise.resolve(marker as never) }),
    );

    await expect(loadFormatLanguage("/x/doc.finelang")).resolves.toBe(marker);
    expect(mocks.formatsWarn).not.toHaveBeenCalled();
  });
});

/**
 * The compartment swap, against a real EditorView.
 *
 * `EditorState.tabSize.of(n)` stands in for a language pack: it is an ordinary
 * Extension, so the compartment treats it identically, and unlike a real pack
 * its effect is one readable number. That makes "the resolved pack replaced
 * the fallback" and "it did NOT replace it" distinguishable — which a test
 * asserting `language !== null` cannot do.
 */
describe("formatLanguageExtension — swapping the pack into a live view", () => {
  const RESOLVED_TAB_SIZE = 7;

  function mount(filePath: string | null) {
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello",
        extensions: formatLanguageExtension(filePath),
      }),
    });
    return view;
  }

  it("mounts with the markdown fallback before the thunk resolves", () => {
    registerFormat(
      splitPaneConfig("slowlang", {
        language: () => new Promise(() => {}) as Promise<never>,
      }),
    );

    const view = mount("/x/doc.slowlang");
    try {
      // The default tabSize means the fallback — not the pending pack — is in
      // the compartment, i.e. the editor is highlighted on the first frame.
      expect(view.state.tabSize).not.toBe(RESOLVED_TAB_SIZE);
    } finally {
      view.destroy();
    }
  });

  it("reconfigures the compartment once the thunk resolves", async () => {
    registerFormat(
      splitPaneConfig("swaplang", {
        language: () =>
          Promise.resolve(EditorState.tabSize.of(RESOLVED_TAB_SIZE) as never),
      }),
    );

    const view = mount("/x/doc.swaplang");
    try {
      await vi.waitFor(() => {
        expect(view.state.tabSize).toBe(RESOLVED_TAB_SIZE);
      });
    } finally {
      view.destroy();
    }
  });

  it("does not touch a view destroyed before the thunk resolved", async () => {
    let release!: (value: never) => void;
    registerFormat(
      splitPaneConfig("racelang", {
        language: () =>
          new Promise<never>((resolve) => {
            release = resolve;
          }),
      }),
    );

    const view = mount("/x/doc.racelang");
    view.destroy();
    release(EditorState.tabSize.of(RESOLVED_TAB_SIZE) as never);
    await Promise.resolve();
    await Promise.resolve();

    // Dispatching into a destroyed view is the unmount-race bug this guard
    // exists for; reaching here without throwing is the assertion.
    expect(view.state.tabSize).not.toBe(RESOLVED_TAB_SIZE);
  });

  it("leaves the fallback in place when the format declares no pack", async () => {
    registerFormat(splitPaneConfig("nopack"));

    const view = mount("/x/doc.nopack");
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(view.state.tabSize).not.toBe(RESOLVED_TAB_SIZE);
    } finally {
      view.destroy();
    }
  });
});
