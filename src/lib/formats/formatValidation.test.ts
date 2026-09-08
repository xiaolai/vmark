// @vitest-environment node
// Audit R3 #793/#794/#795/#796 — the pure half of `registerFormat`, testable
// without a registry. `registry.test.ts` still covers the same rules THROUGH
// registration; these exercise them directly, including the two that were
// previously unreachable from any adapter shape a test could build.
import { describe, expect, it } from "vitest";
import { freezeFormatConfig, validateFormatConfig, type RegistryLookup } from "./formatValidation";
import type { FormatConfig } from "./types";

const EMPTY: RegistryLookup = {
  extensionOwner: () => undefined,
  hasId: () => false,
};

function config(overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    id: "txt",
    nameI18nKey: "format.txt",
    extensions: ["txt"],
    kind: "split-pane",
    adapters: {
      saveDialogFilters: [],
      untitledExtension: "txt",
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
  } as FormatConfig;
}

describe("validateFormatConfig — identity", () => {
  it.each(["", "Txt", "t_x", "tx t"])("rejects the id %o", (id) => {
    expect(() => validateFormatConfig(config({ id }), EMPTY)).toThrowError(/invalid id/);
  });

  it("rejects an id the registry already holds", () => {
    expect(() =>
      validateFormatConfig(config(), { ...EMPTY, hasId: () => true }),
    ).toThrowError(/duplicate id/);
  });
});

describe("validateFormatConfig — extensions", () => {
  it("normalizes case and leading dots", () => {
    expect(validateFormatConfig(config({ extensions: ["  .MD ", "..Markdown"] }), EMPTY)).toEqual([
      "md",
      "markdown",
    ]);
  });

  it.each([[[]], [undefined], ["md"]])("rejects a non-array or empty list: %o", (extensions) => {
    expect(() =>
      validateFormatConfig(config({ extensions } as Partial<FormatConfig>), EMPTY),
    ).toThrowError(/at least one extension/);
  });

  it("rejects a non-string entry", () => {
    expect(() =>
      validateFormatConfig(config({ extensions: [7] as unknown as string[] }), EMPTY),
    ).toThrowError(/must be a string/);
  });

  it("rejects an entry that is only dots and space", () => {
    expect(() => validateFormatConfig(config({ extensions: [" . "] }), EMPTY)).toThrowError(
      /non-empty/,
    );
  });

  it.each(["tar.gz", "a/b", "a\\b", "md?x", "md#x", "m d"])(
    "rejects %o — not a shape the lookup key can be (#794)",
    (ext) => {
      expect(() => validateFormatConfig(config({ extensions: [ext] }), EMPTY)).toThrowError(
        /is not a lookup key/,
      );
    },
  );

  it("rejects a duplicate within one config", () => {
    expect(() =>
      validateFormatConfig(config({ extensions: ["md", ".MD"] }), EMPTY),
    ).toThrowError(/more than once/);
  });

  it("names the format that already owns a colliding extension", () => {
    expect(() =>
      validateFormatConfig(config(), { ...EMPTY, extensionOwner: () => "markdown" }),
    ).toThrowError(/already registered by "markdown"/);
  });

  it("checks EVERY entry before returning, so a later collision is not missed", () => {
    expect(() =>
      validateFormatConfig(config({ extensions: ["ok", "tar.gz"] }), EMPTY),
    ).toThrowError(/is not a lookup key/);
  });
});

describe("validateFormatConfig — surfaces", () => {
  const surface = (() => null) as unknown as NonNullable<FormatConfig["wysiwygComponent"]>;

  it("requires a wysiwyg format to bring its own surface (#795, one guard)", () => {
    expect(() => validateFormatConfig(config({ kind: "wysiwyg" }), EMPTY)).toThrowError(
      /must declare wysiwygComponent/,
    );
  });

  it("refuses loadLanguage on a wysiwyg format", () => {
    expect(() =>
      validateFormatConfig(
        config({ kind: "wysiwyg", wysiwygComponent: surface, loadLanguage: async () => [] } as Partial<FormatConfig>),
        EMPTY,
      ),
    ).toThrowError(/must not declare loadLanguage/);
  });

  it.each(["wysiwygComponent", "language", "loadLanguage", "loadExtraExtensions"])(
    "rejects a non-callable %s (#796)",
    (field) => {
      expect(() =>
        validateFormatConfig(config({ [field]: {} } as Partial<FormatConfig>), EMPTY),
      ).toThrowError(new RegExp(`${field} must be an import thunk`));
    },
  );

  it("accepts every lazy field as a thunk", () => {
    expect(
      validateFormatConfig(
        config({
          language: async () => [],
          loadLanguage: async () => [],
          loadExtraExtensions: async () => [],
        } as Partial<FormatConfig>),
        EMPTY,
      ),
    ).toEqual(["txt"]);
  });
});

describe("validateFormatConfig — adapter policy", () => {
  it("refuses readOnlyDefault without prompt-on-close", () => {
    const base = config();
    expect(() =>
      validateFormatConfig(
        config({
          adapters: { ...base.adapters, readOnlyDefault: true, closeSavePolicy: "discard" },
        } as unknown as Partial<FormatConfig>),
        EMPTY,
      ),
    ).toThrowError(/readOnlyDefault.*prompt-on-close/);
  });

  it("exempts kind=media, which is never editable", () => {
    const base = config();
    expect(() =>
      validateFormatConfig(
        config({
          kind: "media",
          adapters: { ...base.adapters, readOnlyDefault: true, closeSavePolicy: "discard" },
        } as unknown as Partial<FormatConfig>),
        EMPTY,
      ),
    ).not.toThrow();
  });
});

describe("freezeFormatConfig", () => {
  it("rewrites the extensions in place, so the caller's object matches the indexes", () => {
    const cfg = config({ extensions: [".MD", "Markdown"] });
    const held = cfg.extensions;
    freezeFormatConfig(cfg, ["md", "markdown"]);
    expect(held).toEqual(["md", "markdown"]);
    expect(cfg.extensions).toBe(held);
  });

  it("freezes the config, its extensions and its adapters", () => {
    const cfg = config();
    freezeFormatConfig(cfg, ["txt"]);
    expect(() => (cfg.extensions as string[]).push("x")).toThrow(TypeError);
    expect(() => {
      (cfg.adapters as { readOnlyDefault: boolean }).readOnlyDefault = true;
    }).toThrow(TypeError);
    expect(() => {
      (cfg as { id: string }).id = "other";
    }).toThrow(TypeError);
  });

  it("does NOT recurse: a React.lazy schema renderer must stay mutable", () => {
    // React.lazy writes `_status`/`_result` onto its own object as the chunk
    // resolves; freezing those would break the preview it exists to render.
    const renderer = { _status: 0 };
    const cfg = config({ schemaRenderers: { x: renderer } } as unknown as Partial<FormatConfig>);
    freezeFormatConfig(cfg, ["txt"]);
    renderer._status = 1;
    expect(renderer._status).toBe(1);
  });

  it("is idempotent — re-freezing an already frozen config does not throw", () => {
    const cfg = config();
    freezeFormatConfig(cfg, ["txt"]);
    expect(() => freezeFormatConfig(cfg, ["txt"])).not.toThrow();
  });
});
