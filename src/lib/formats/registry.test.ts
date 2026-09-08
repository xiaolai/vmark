// @vitest-environment node
// WI-1A.2 — Format registry tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerFormat,
  dispatchEditor,
  getFormatById,
  listFormats,
  getSupportedExtensions,
  setFormatAssociationsProvider,
  __resetFormatAssociationsProvider,
  __resetRegistry,
  replaceRegistry,
} from "./registry";
import type { FormatConfig } from "./types";

const baseAdapters: FormatConfig["adapters"] = {
  saveDialogFilters: [{ nameI18nKey: "format.txt", extensions: ["txt"] }],
  untitledExtension: "txt",
  readOnlyDefault: false,
  closeSavePolicy: "prompt-on-close",
  menuPolicy: {
    sourceWysiwygToggle: false,
    cjkFormatActions: false,
    insertBlockActions: false,
    paragraphFormatting: false,
  },
};

const txtConfig: FormatConfig = {
  id: "txt",
  nameI18nKey: "format.txt",
  extensions: ["txt"],
  kind: "split-pane",
  adapters: baseAdapters,
};

const mdAdapters: FormatConfig["adapters"] = {
  ...baseAdapters,
  saveDialogFilters: [
    { nameI18nKey: "format.markdown", extensions: ["md", "markdown"] },
  ],
  untitledExtension: "md",
  menuPolicy: {
    sourceWysiwygToggle: true,
    cjkFormatActions: true,
    insertBlockActions: true,
    paragraphFormatting: true,
  },
};

const StubComponent = (() => null) as unknown as NonNullable<FormatConfig["wysiwygComponent"]>;

const mdConfig: FormatConfig = {
  id: "markdown",
  nameI18nKey: "format.markdown",
  extensions: ["md", "markdown", "mdown", "mkd", "mdx"],
  kind: "wysiwyg",
  wysiwygComponent: StubComponent,
  adapters: mdAdapters,
};

describe("format registry", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
  });
  afterEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
  });

  describe("registerFormat", () => {
    it("registers and retrieves by id", () => {
      registerFormat(txtConfig);
      expect(getFormatById("txt")).toBe(txtConfig);
    });

    it("rejects empty id", () => {
      expect(() =>
        registerFormat({ ...txtConfig, id: "" }),
      ).toThrowError(/id/);
    });

    it("rejects id with invalid characters", () => {
      expect(() =>
        registerFormat({ ...txtConfig, id: "Foo_Bar" }),
      ).toThrowError(/id/);
    });

    it("rejects duplicate id", () => {
      registerFormat(txtConfig);
      expect(() => registerFormat(txtConfig)).toThrowError(/duplicate id/i);
    });

    it("rejects empty extensions", () => {
      expect(() =>
        registerFormat({ ...txtConfig, extensions: [] }),
      ).toThrowError(/extension/i);
    });

    it("rejects extension collision with another format", () => {
      registerFormat(txtConfig);
      expect(() =>
        registerFormat({
          ...txtConfig,
          id: "other",
          extensions: ["txt"],
        }),
      ).toThrowError(/collision|already registered/i);
    });

    it("rejects wysiwyg kind without wysiwygComponent", () => {
      // Omitted, not set to `undefined`: the field is optional, and under
      // exactOptionalPropertyTypes an explicit `undefined` is not a value.
      const { wysiwygComponent: _surface, ...withoutSurface } = mdConfig;
      expect(() => registerFormat(withoutSurface)).toThrowError(/wysiwygComponent/);
    });

    it("rejects wysiwyg kind that also declares loadLanguage", () => {
      expect(() =>
        registerFormat({
          ...mdConfig,
          loadLanguage: async () => ({}) as never,
        }),
      ).toThrowError(/wysiwyg.*loadLanguage/i);
    });

    it("allows split-pane stub without loadLanguage (Phase 1A stub fallback)", () => {
      const stub: FormatConfig = {
        id: "json",
        nameI18nKey: "format.json",
        extensions: ["json"],
        kind: "split-pane",
        adapters: baseAdapters,
      };
      expect(() => registerFormat(stub)).not.toThrow();
    });

    it("allows plain txt with no loadLanguage", () => {
      expect(() => registerFormat(txtConfig)).not.toThrow();
    });

    it("rejects readOnlyDefault=true with non-prompt-on-close closeSavePolicy", () => {
      expect(() =>
        registerFormat({
          ...txtConfig,
          adapters: {
            ...baseAdapters,
            readOnlyDefault: true,
            closeSavePolicy: "save-as-only",
          },
        }),
      ).toThrowError(/readOnlyDefault.*prompt-on-close/i);
    });

    it("normalizes extensions: strips leading dot", () => {
      registerFormat({ ...txtConfig, extensions: [".txt"] });
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
      expect(getSupportedExtensions()).toContain("txt");
      expect(getSupportedExtensions()).not.toContain(".txt");
    });

    it("normalizes extensions: trims whitespace", () => {
      registerFormat({ ...txtConfig, extensions: ["  txt  "] });
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
    });

    it("normalizes extensions: lowercases", () => {
      registerFormat({ ...txtConfig, extensions: ["TXT"] });
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
      expect(dispatchEditor("/x/foo.TXT").id).toBe("txt");
    });

    it("rejects empty extension after normalization", () => {
      expect(() =>
        registerFormat({ ...txtConfig, extensions: ["   "] }),
      ).toThrowError(/non-empty/);
      expect(() =>
        registerFormat({ ...txtConfig, extensions: ["."] }),
      ).toThrowError(/non-empty/);
    });

    it("rejects non-string extensions", () => {
      expect(() =>
        registerFormat({
          ...txtConfig,
          extensions: [123 as unknown as string],
        }),
      ).toThrowError(/string/);
    });

    it("rejects same extension declared twice in one format", () => {
      expect(() =>
        registerFormat({ ...txtConfig, extensions: ["txt", "TXT"] }),
      ).toThrowError(/more than once/);
    });
  });

  describe("dispatchEditor", () => {
    beforeEach(() => {
      registerFormat(mdConfig);
      registerFormat(txtConfig);
    });

    it("returns markdown for null path (untitled)", () => {
      expect(dispatchEditor(null).id).toBe("markdown");
    });

    it("matches by extension (case-insensitive)", () => {
      expect(dispatchEditor("/x/foo.MD").id).toBe("markdown");
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
    });

    it("matches each registered markdown extension", () => {
      for (const ext of ["md", "markdown", "mdown", "mkd", "mdx"]) {
        expect(dispatchEditor(`/x/foo.${ext}`).id).toBe("markdown");
      }
    });

    it("returns plain-text fallback for unknown extension", () => {
      expect(dispatchEditor("/x/foo.unknown").id).toBe("txt");
    });

    it("returns plain-text fallback for paths with no extension", () => {
      expect(dispatchEditor("/x/Makefile").id).toBe("txt");
    });

    it("strips query string before extension match", () => {
      expect(dispatchEditor("/x/foo.md?reload=1").id).toBe("markdown");
    });

    it("strips fragment before extension match", () => {
      expect(dispatchEditor("/x/foo.md#section").id).toBe("markdown");
    });

    it("strips both query and fragment", () => {
      expect(dispatchEditor("/x/foo.txt?v=2#l3").id).toBe("txt");
    });

    // Audit 20260907 round 2: the built-in map was consulted with the full
    // lookup-key list, whose first entry is the whole BASENAME — so a file
    // with no extension whose name happens to be a registered one opened in
    // that format, and `md` reached the WYSIWYG markdown editor against the
    // "markdown is an allowlist, not a default" contract.
    it.each(["/x/md", "/x/markdown", "/x/txt", "/x/MD"])(
      "%s has no extension, so it is plain text and not that format",
      (path) => {
        expect(dispatchEditor(path).id).toBe("txt");
      },
    );

    it("a user association still matches on the full filename", () => {
      setFormatAssociationsProvider(() => ({ md: "markdown" }));
      expect(dispatchEditor("/x/md").id).toBe("markdown");
    });
  });

  describe("dispatchEditor without txt fallback registered", () => {
    it("returns markdown for null path even when no fallback exists", () => {
      registerFormat(mdConfig);
      expect(dispatchEditor(null).id).toBe("markdown");
    });

    // Audit 20260907 round 2: the untitled branch degraded through
    // `txt ?? the first registered format`, so a bootstrap that lost markdown
    // opened new documents in the plain source pane — or in whatever happened
    // to register first — with nothing said. `bootstrapFormats` registers
    // markdown unconditionally, so its absence is a defect, and the pathed
    // branch already fails this way.
    it("throws for an untitled document when markdown is not registered", () => {
      registerFormat(txtConfig);
      expect(() => dispatchEditor(null)).toThrowError(/markdown format "markdown" is not registered/);
    });

    it("throws for an untitled document when nothing is registered at all", () => {
      expect(() => dispatchEditor(null)).toThrowError(/markdown format "markdown" is not registered/);
    });

    // Audit 20260907 (#404): the pathed fallback used to be
    // `txt ?? markdown ?? first`, which handed an unknown file the WYSIWYG
    // markdown editor whenever txt was missing — the exact grant the
    // "NEVER markdown for a pathed file" contract above forbids. A missing
    // txt is a bootstrap defect and fails loudly instead.
    it("throws for a pathed unknown file when txt is not registered — never markdown", () => {
      registerFormat(mdConfig);
      expect(() => dispatchEditor("/x/foo.unknown")).toThrowError(/plain-text fallback "txt" is not registered/);
    });
  });

  // Audit 20260907 (#403): the registry indexed the normalized extensions and
  // the id but served the caller's own mutable object, so a later write could
  // desynchronize `formats`, `byId` and `byExt`, and `extensions` read back in
  // whatever spelling the adapter used.
  describe("a registered config is frozen with normalized extensions (#403)", () => {
    it("reads its extensions back normalized, on the same object it serves", () => {
      const declared = { ...txtConfig, extensions: [" .TXT ", "Text"] };
      registerFormat(declared);
      const served = getFormatById("txt")!;
      expect(served).toBe(declared);
      expect(served.extensions).toEqual(["txt", "text"]);
      expect(getSupportedExtensions()).toEqual(["txt", "text"]);
    });

    it("refuses a later write to the id or the extensions", () => {
      const cfg = { ...txtConfig, extensions: ["txt"] };
      registerFormat(cfg);
      expect(Object.isFrozen(cfg)).toBe(true);
      expect(() => {
        cfg.id = "renamed";
      }).toThrow(TypeError);
      expect(() => {
        cfg.extensions.push("log");
      }).toThrow(TypeError);
      expect(getFormatById("txt")?.id).toBe("txt");
      expect(dispatchEditor("/x/notes.txt").id).toBe("txt");
    });

    it("re-registers a config a previous bootstrap already froze", () => {
      registerFormat(txtConfig);
      __resetRegistry();
      expect(() => registerFormat(txtConfig)).not.toThrow();
      expect(dispatchEditor("/x/notes.txt").id).toBe("txt");
    });
  });

  // Audit R2 (#797/#800): the freeze stopped one level short, and the list was
  // the registry's own mutable array behind a compile-time `readonly`.
  describe("what a caller can do to a registered config", () => {
    it("refuses a write to the adapters block that was validated on the way in", () => {
      const cfg: FormatConfig = {
        ...txtConfig,
        id: "frozen",
        extensions: ["fz"],
        adapters: { ...baseAdapters },
      };
      registerFormat(cfg);

      expect(Object.isFrozen(cfg.adapters)).toBe(true);
      expect(() => {
        (cfg.adapters as { readOnlyDefault: boolean }).readOnlyDefault = true;
      }).toThrow(TypeError);
    });

    it("hands out a frozen list, and the same one until the registry changes", () => {
      registerFormat(mdConfig);
      const first = listFormats();

      expect(Object.isFrozen(first)).toBe(true);
      expect(() => (first as FormatConfig[]).push(txtConfig)).toThrow(TypeError);
      expect(listFormats()).toBe(first);

      registerFormat(txtConfig);
      const second = listFormats();
      expect(second).not.toBe(first);
      expect(second.map((f) => f.id)).toEqual(["markdown", "txt"]);
    });
  });

  describe("listFormats / getSupportedExtensions", () => {
    it("listFormats returns registered formats in insertion order", () => {
      registerFormat(mdConfig);
      registerFormat(txtConfig);
      expect(listFormats().map((f) => f.id)).toEqual(["markdown", "txt"]);
    });

    it("getSupportedExtensions returns all unique extensions", () => {
      registerFormat(mdConfig);
      registerFormat(txtConfig);
      const exts = getSupportedExtensions();
      expect(exts).toContain("md");
      expect(exts).toContain("markdown");
      expect(exts).toContain("txt");
    });

    it("getSupportedExtensions has no duplicates", () => {
      registerFormat(mdConfig);
      const exts = getSupportedExtensions();
      const set = new Set(exts);
      expect(set.size).toBe(exts.length);
    });
  });
});

// Audit R3 #794/#796/#801.
describe("format registry — an extension the lookup can actually resolve (#794)", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
  });
  afterEach(() => __resetRegistry());

  it.each(["tar.gz", "a/b", "a\\b", "md?x", "md#x", "m d"])(
    "refuses %s, which dispatchEditor could never look up",
    (ext) => {
      expect(() => registerFormat({ ...txtConfig, id: "x", extensions: [ext] })).toThrowError(
        /extension/i,
      );
    },
  );

  it("a compound extension would otherwise register and never match", () => {
    // `formatExtensionKey("/x/a.tar.gz")` is "gz" — the key "tar.gz" is
    // unreachable, so the format silently never dispatched.
    expect(() =>
      registerFormat({ ...txtConfig, id: "targz", extensions: ["tar.gz"] }),
    ).toThrow();
  });
});

describe("format registry — every lazy field is validated as a thunk (#796)", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
  });
  afterEach(() => __resetRegistry());

  it.each(["loadLanguage", "loadExtraExtensions"])(
    "rejects a non-callable %s, instead of failing at first use",
    (field) => {
      expect(() =>
        registerFormat({
          ...txtConfig,
          [field]: "not-a-thunk",
        } as unknown as FormatConfig),
      ).toThrowError(new RegExp(`${field}.*import thunk`, "i"));
    },
  );

  it("still accepts a real thunk for each", () => {
    expect(() =>
      registerFormat({
        ...txtConfig,
        loadLanguage: async () => [],
        loadExtraExtensions: async () => [],
      } as unknown as FormatConfig),
    ).not.toThrow();
  });
});

describe("replaceRegistry — a failed rebuild leaves the live registry untouched (#801)", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
  });
  afterEach(() => __resetRegistry());

  it("commits when the rebuild completes", () => {
    registerFormat(txtConfig);
    replaceRegistry(() => registerFormat(mdConfig));
    expect(getFormatById("markdown")?.id).toBe("markdown");
    expect(getFormatById("txt")).toBeUndefined();
  });

  it("restores the previous registry when the rebuild throws part way", () => {
    registerFormat(txtConfig);
    registerFormat(mdConfig);
    expect(() =>
      replaceRegistry(() => {
        registerFormat({ ...mdConfig });
        registerFormat({ ...txtConfig, id: "BAD ID" });
      }),
    ).toThrow();
    // The half-built registry is gone; the one that was serving requests stayed.
    expect(getFormatById("txt")?.id).toBe("txt");
    expect(getFormatById("markdown")?.id).toBe("markdown");
    expect(listFormats().map((f) => f.id)).toEqual(["txt", "markdown"]);
  });

  it("leaves dispatchEditor working over the old registry after a failed rebuild", () => {
    registerFormat(txtConfig);
    registerFormat(mdConfig);
    expect(() =>
      replaceRegistry(() => {
        throw new Error("adapter blew up");
      }),
    ).toThrowError(/adapter blew up/);
    expect(dispatchEditor("/x/notes.md").id).toBe("markdown");
    expect(dispatchEditor(null).id).toBe("markdown");
  });
});
