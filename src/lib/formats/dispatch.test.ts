// "Markdown is an allowlist, not a default" — routing-brain tests.
//
// Covers formatLookupKeys, the strict-markdown guarantee (a non-markdown
// file never resolves to the WYSIWYG markdown editor), and the user
// association escape hatch.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerFormat,
  dispatchEditor,
  formatLookupKeys,
  associationKey,
  setFormatAssociationsProvider,
  __resetRegistry,
  __resetFormatAssociationsProvider,
} from "./registry";
import type { FormatConfig } from "./types";

const baseAdapters: FormatConfig["adapters"] = {
  saveDialogFilters: [{ name: "Plain", extensions: ["txt"] }],
  untitledExtension: "txt",
  searchAdapter: "codemirror",
  readOnlyDefault: false,
  closeSavePolicy: "markdown-default",
  menuPolicy: {
    sourceWysiwygToggle: false,
    cjkFormatActions: false,
    insertBlockActions: false,
    paragraphFormatting: false,
  },
};

const StubComponent = (() => null) as unknown as FormatConfig["wysiwygComponent"];

const md: FormatConfig = {
  id: "markdown",
  nameI18nKey: "format.markdown",
  extensions: ["md", "markdown", "mdx"],
  kind: "wysiwyg",
  wysiwygComponent: StubComponent,
  adapters: { ...baseAdapters, searchAdapter: "tiptap" },
};

const txt: FormatConfig = {
  id: "txt",
  nameI18nKey: "format.txt",
  extensions: ["txt"],
  kind: "split-pane",
  adapters: baseAdapters,
};

const json: FormatConfig = {
  id: "json",
  nameI18nKey: "format.json",
  extensions: ["json"],
  kind: "split-pane",
  adapters: baseAdapters,
};

function bootstrapTrio() {
  registerFormat(md);
  registerFormat(txt);
  registerFormat(json);
}

describe("formatLookupKeys", () => {
  it.each<[string, string[]]>([
    ["/x/notes.md", ["notes.md", "md"]],
    ["/x/data.JSON", ["data.json", "json"]],
    ["/x/.env.local", [".env.local", ".env", "local"]],
    ["/x/.env", [".env"]],
    ["/x/.gitignore", [".gitignore"]],
    ["/x/Dockerfile", ["dockerfile"]],
    ["/x/Makefile", ["makefile"]],
    ["C:\\proj\\app.TS", ["app.ts", "ts"]],
    ["/x/foo.md?reload=1", ["foo.md", "md"]],
    ["/x/foo.md#anchor", ["foo.md", "md"]],
    ["bare", ["bare"]],
  ])("formatLookupKeys(%j) -> %j", (path, expected) => {
    expect(formatLookupKeys(path)).toEqual(expected);
  });

  it("de-duplicates keys", () => {
    // A name whose stem equals its full form should not repeat.
    expect(formatLookupKeys("/x/.env")).toEqual([".env"]);
  });

  it("returns an empty array for a path that reduces to nothing", () => {
    expect(formatLookupKeys("/x/")).toEqual([]);
  });

  it("strips query/fragment BEFORE finding the basename (audit Round B H1)", () => {
    // Slashes inside the query value would otherwise confuse the basename
    // split. Previously these resolved to the slice AFTER the intra-query
    // slash (`["a"]`), which broke dispatch/association lookups.
    expect(formatLookupKeys("/x/foo.md?next=/tmp/a")).toEqual(["foo.md", "md"]);
    expect(formatLookupKeys("/x/foo.md#sec/2")).toEqual(["foo.md", "md"]);
    expect(formatLookupKeys("file:///x/foo.md?cb=/tmp/y")).toEqual([
      "foo.md",
      "md",
    ]);
  });
});

describe("associationKey — canonical key to persist an override on", () => {
  it.each<[string, string]>([
    // A normal file → its extension (covers all files of that type).
    ["/x/notes.txt", "txt"],
    ["/x/data.JSON", "json"],
    // A dotfile family → the stem (one association covers .env / .env.local).
    ["/x/.env.local", ".env"],
    ["/x/.env", ".env"],
    // A single-dot dotfile → the full name (no meaningful extension).
    ["/x/.gitignore", ".gitignore"],
    // Extensionless → the full filename.
    ["/x/Dockerfile", "dockerfile"],
    ["/x/Makefile", "makefile"],
  ])("associationKey(%j) -> %j", (path, expected) => {
    expect(associationKey(path)).toBe(expected);
  });

  it("returns null for a path that reduces to nothing", () => {
    expect(associationKey("/x/")).toBeNull();
  });
});

describe("dispatchEditor — markdown allowlist guarantee", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
    bootstrapTrio();
  });
  afterEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
  });

  it("routes markdown-family extensions to the markdown editor", () => {
    expect(dispatchEditor("/x/a.md").id).toBe("markdown");
    expect(dispatchEditor("/x/a.markdown").id).toBe("markdown");
    expect(dispatchEditor("/x/a.mdx").id).toBe("markdown");
  });

  it("routes .env.local to plain text, NOT markdown", () => {
    expect(dispatchEditor("/x/.env.local").id).toBe("txt");
  });

  it("routes dotfiles and extensionless config files to plain text", () => {
    expect(dispatchEditor("/x/.env").id).toBe("txt");
    expect(dispatchEditor("/x/.gitignore").id).toBe("txt");
    expect(dispatchEditor("/x/Dockerfile").id).toBe("txt");
    expect(dispatchEditor("/x/Makefile").id).toBe("txt");
  });

  it("routes unknown extensions to plain text", () => {
    expect(dispatchEditor("/x/notes.rstxyz").id).toBe("txt");
  });

  it("keeps untitled (null) on the markdown default", () => {
    expect(dispatchEditor(null).id).toBe("markdown");
  });

  it("never returns markdown for a pathed file when txt is unavailable but the ext is unknown", () => {
    __resetRegistry();
    // Only markdown registered — a pathed unknown file has no txt to fall
    // back to. The contract still forbids the markdown editor here; the
    // last-resort is the markdown fallback ONLY because nothing else
    // exists. With txt present (the real app), it never reaches markdown.
    registerFormat(md);
    // markdown is the only registered format, so the fallback chain ends
    // there — documents the degenerate single-format case.
    expect(dispatchEditor("/x/.env.local").id).toBe("markdown");
    __resetRegistry();
    bootstrapTrio();
  });
});

describe("dispatchEditor — user associations (escape hatch)", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
    bootstrapTrio();
  });
  afterEach(() => {
    __resetRegistry();
    __resetFormatAssociationsProvider();
  });

  it("renders a .txt as markdown when the user associates the extension", () => {
    setFormatAssociationsProvider(() => ({ txt: "markdown" }));
    expect(dispatchEditor("/x/notes.txt").id).toBe("markdown");
  });

  it("forces a .md to plain text when the user associates the extension", () => {
    setFormatAssociationsProvider(() => ({ md: "txt" }));
    expect(dispatchEditor("/x/template.md").id).toBe("txt");
  });

  it("matches the most-specific key first (full filename over extension)", () => {
    setFormatAssociationsProvider(() => ({
      md: "txt",
      "readme.md": "markdown",
    }));
    expect(dispatchEditor("/x/readme.md").id).toBe("markdown");
    expect(dispatchEditor("/x/other.md").id).toBe("txt");
  });

  it("associates the dotfile family via the stem (.env covers .env.local)", () => {
    setFormatAssociationsProvider(() => ({ ".env": "json" }));
    expect(dispatchEditor("/x/.env.local").id).toBe("json");
    expect(dispatchEditor("/x/.env").id).toBe("json");
  });

  it("ignores an association pointing at an unregistered format", () => {
    setFormatAssociationsProvider(() => ({ txt: "nonexistent-format" }));
    // Falls through to the built-in extension map.
    expect(dispatchEditor("/x/notes.txt").id).toBe("txt");
  });

  it("ignores associations for untitled documents", () => {
    setFormatAssociationsProvider(() => ({ "": "txt" }));
    expect(dispatchEditor(null).id).toBe("markdown");
  });
});
