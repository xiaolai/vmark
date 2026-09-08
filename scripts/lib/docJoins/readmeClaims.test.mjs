// WI-FL0.5 — README-claims doc join: the README's feature claims against the registries they restate.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PATHS,
  checkReadme,
  countShortcutDefinitions,
  id,
  parseLanguages,
  parseNonMacThemeIds,
  parseProviders,
  parseThemeIds,
  run,
} from "./readmeClaims.mjs";
import { DEFAULT_SHORTCUTS } from "../../../src/stores/settingsStore/shortcutDefinitions.ts";
import { themes } from "../../../src/theme/themes/index.ts";
import { NON_MAC_THEME_IDS } from "../../../src/theme/themeAvailability.ts";

const REPO = resolve(import.meta.dirname, "../../..");

// ── registry fixtures ──────────────────────────────────────────────────────

const RUST = `
pub(crate) struct ProviderConfig {
    pub name: &'static str,
    pub id: &'static str,
    pub relative_path: &'static str,
    pub legacy: bool,
}

pub(crate) const PROVIDERS: &[ProviderConfig] = &[
    ProviderConfig {
        name: "Claude Desktop",
        id: "claude-desktop",
        relative_path: CLAUDE_DESKTOP_PATH,
        legacy: false,
    },
    // Retired, kept as prose: ProviderConfig { name: "Old Tool", id: "old", relative_path: "x", legacy: false },
    ProviderConfig {
        name: "Codex CLI", // a trailing note with a brace }
        id: "codex",
        relative_path: ".codex/config.toml",
        legacy: false,
    },
    /* block comment with an entry: ProviderConfig { name: "Ghost", id: "ghost", relative_path: "g", legacy: false } */
    ProviderConfig {
        name: "Gemini CLI",
        id: "gemini",
        relative_path: ".gemini/settings.json",
        legacy: true,
    },
];

pub(crate) fn get_provider_config(provider: &str) -> Result<&'static ProviderConfig, CommandError> {
    PROVIDERS.iter().find(|p| p.id == provider).ok_or_else(|| todo!())
}
`;

const TSX = `
import { useRef } from "react";

const ALL_LANGUAGES = [
  { value: "en", label: "English" },
  // { value: "xx", label: "Retired" },
  { value: "zh-CN", label: "简体中文" },
  { value: "pt-BR", label: "Português (Brasil)" },
] as const;

const LANGUAGE_OPTIONS = ALL_LANGUAGES.filter((lang) => availableLocales.has(lang.value));
`;

const THEMES_TS = `
import { paper } from "./paper";

export const themes = {
  white,
  paper, // the default
  mint: mintTheme,
  night,
} satisfies Record<string, ThemeTokens>;

export type ThemeId = keyof typeof themes;
`;

const AVAIL_TS = `
export const NON_MAC_THEME_IDS: readonly ThemeId[] = Object.freeze([
  "white",
  "night",
] as ThemeId[]);

export function selectableThemeIds(isMac: boolean): ThemeId[] {
  return isMac ? (Object.keys(themes) as ThemeId[]) : [...NON_MAC_THEME_IDS];
}
`;

const SHORTCUTS_TS = `
export interface ShortcutDefinition {
  id: string;
  defaultKey: string;
  defaultKeyMac?: string;
  defaultKeyOther?: string;
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // === Formatting === { id: "not-an-entry", defaultKey: "x" }
  { id: "bold", label: "Bold", category: "formatting", defaultKey: "Mod-b", menuId: "bold" },
  { id: "brace", label: "Curly {", category: "formatting", defaultKey: "Mod-{", description: "a } in a string" },
  {
    id: "multi",
    label: 'Spans lines',
    category: "view",
    defaultKey: \`Ctrl-Shift-0\`,
    defaultKeyOther: "Alt-Shift-0",
    meta: { nested: { deeper: true } },
  }, // trailing comment with { braces }
];

export const CATEGORY_ORDER = [{ id: "x", defaultKey: "y" }];
`;

const REG = {
  providers: [
    { name: "Claude Desktop", id: "claude-desktop", legacy: false },
    { name: "Claude Code", id: "claude", legacy: false },
    { name: "Codex CLI", id: "codex", legacy: false },
    { name: "Gemini CLI", id: "gemini", legacy: true },
  ],
  languages: [
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
    { value: "pt-BR", label: "Português (Brasil)" },
  ],
  themeIds: ["white", "paper", "night"],
  nonMacThemeIds: ["white", "night"],
  shortcutCount: 127,
};

// ── README fixture ─────────────────────────────────────────────────────────

const LINES = {
  aiNative:
    "- **AI-Native** — MCP integration for Claude Desktop, Claude Code, and Codex CLI. AI Genies for inline writing assistance.",
  languages: "- **3 Languages** — English · 简体中文 · Português (Brasil). Auto-detected on first launch.",
  themes: "- **3 Themes** — White, Paper, Night on macOS; Windows and Linux offer White and Night.",
  shortcuts: "- **Shortcuts** — Every one customizable in Settings",
  supported: "Supported: Claude Desktop, Claude Code, Codex CLI.",
};

/** A README with the claim lines the join reads; `null` drops a line. */
function readme(overrides = {}) {
  const l = { ...LINES, ...overrides };
  return [
    "# Fixture",
    "",
    "## Highlights",
    "",
    l.aiNative,
    l.languages,
    l.themes,
    l.shortcuts,
    "- **Local-First** — No cloud.",
    "",
    "## AI Integration",
    "",
    l.supported,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function findingsFor(overrides, registries = REG) {
  return checkReadme(readme(overrides), registries).findings;
}

// ── parsers ────────────────────────────────────────────────────────────────

describe("parseProviders", () => {
  it("reads name, id and legacy from every live entry of PROVIDERS, ignoring commented-out ones", () => {
    expect(parseProviders(RUST)).toEqual([
      { name: "Claude Desktop", id: "claude-desktop", legacy: false },
      { name: "Codex CLI", id: "codex", legacy: false },
      { name: "Gemini CLI", id: "gemini", legacy: true },
    ]);
  });

  it("throws when the PROVIDERS slice is absent — a silent [] would pass every README", () => {
    expect(() => parseProviders("pub(crate) const OTHER: &[u8] = &[];")).toThrow(/PROVIDERS/);
  });

  it("throws on an entry missing a field", () => {
    const broken = RUST.replace("legacy: true,", "");
    expect(() => parseProviders(broken)).toThrow(/legacy/);
  });
});

describe("parseLanguages", () => {
  it("reads value and label from ALL_LANGUAGES, ignoring commented-out entries", () => {
    expect(parseLanguages(TSX)).toEqual([
      { value: "en", label: "English" },
      { value: "zh-CN", label: "简体中文" },
      { value: "pt-BR", label: "Português (Brasil)" },
    ]);
  });

  it("throws when ALL_LANGUAGES is absent", () => {
    expect(() => parseLanguages("const OTHER = [];")).toThrow(/ALL_LANGUAGES/);
  });
});

describe("parseThemeIds", () => {
  it("reads shorthand and key: value members of the themes map", () => {
    expect(parseThemeIds(THEMES_TS)).toEqual(["white", "paper", "mint", "night"]);
  });

  it("throws when the themes map is absent", () => {
    expect(() => parseThemeIds("export const other = {};")).toThrow(/themes/);
  });
});

describe("parseNonMacThemeIds", () => {
  it("reads the string literals of NON_MAC_THEME_IDS", () => {
    expect(parseNonMacThemeIds(AVAIL_TS)).toEqual(["white", "night"]);
  });

  it("throws when NON_MAC_THEME_IDS is absent", () => {
    expect(() => parseNonMacThemeIds("export const OTHER = [];")).toThrow(/NON_MAC_THEME_IDS/);
  });
});

describe("countShortcutDefinitions", () => {
  it("counts object literals directly inside DEFAULT_SHORTCUTS — not braces in strings, comments, nested objects or later arrays", () => {
    expect(countShortcutDefinitions(SHORTCUTS_TS)).toBe(3);
    // The trap this replaces: `grep -c defaultKey` says 7 here (3 interface members, 1 comment, 3 entries… plus CATEGORY_ORDER).
    expect((SHORTCUTS_TS.match(/defaultKey/g) ?? []).length).toBeGreaterThan(3);
  });

  it("throws when DEFAULT_SHORTCUTS is absent", () => {
    expect(() => countShortcutDefinitions("export const OTHER = [];")).toThrow(/DEFAULT_SHORTCUTS/);
  });
});

// ── checkReadme ────────────────────────────────────────────────────────────

describe("checkReadme — clean", () => {
  it("reports no findings and an info line when every claim matches its registry", () => {
    const { findings, info } = checkReadme(readme(), REG);
    expect(findings).toEqual([]);
    expect(info.join("\n")).toMatch(/3 MCP targets/);
  });

  it("is order-insensitive for the provider list and the theme lists", () => {
    expect(
      findingsFor({
        supported: "Supported: Codex CLI, Claude Desktop, Claude Code.",
        themes: "- **3 Themes** — Night, White, Paper on macOS; Windows and Linux offer Night and White.",
      }),
    ).toEqual([]);
  });
});

describe("checkReadme — MCP targets", () => {
  it("flags a non-legacy provider missing from the Supported line", () => {
    const findings = findingsFor({ supported: "Supported: Claude Desktop, Claude Code." });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Supported/);
    expect(findings[0]).toMatch(/Codex CLI/);
  });

  it("flags a legacy provider wherever the README names it, once, with its line number", () => {
    const findings = findingsFor({
      supported: "Supported: Claude Desktop, Claude Code, Codex CLI, Gemini CLI.",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/legacy/);
    expect(findings[0]).toMatch(/Gemini CLI/);
    expect(findings[0]).toMatch(/:13\b/);
  });

  it("flags a name on the Supported line that is not a provider at all", () => {
    const findings = findingsFor({ supported: "Supported: Claude Desktop, Claude Code, Codex CLI, Foo Tool." });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Foo Tool/);
  });

  it("flags a missing Supported line", () => {
    const findings = findingsFor({ supported: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Supported/);
  });

  it("flags an AI-Native bullet that does not mention every non-legacy provider", () => {
    const findings = findingsFor({
      aiNative: "- **AI-Native** — MCP integration for Claude Desktop and Claude Code.",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/AI-Native/);
    expect(findings[0]).toMatch(/Codex CLI/);
  });

  it("flags a missing AI-Native bullet", () => {
    const findings = findingsFor({ aiNative: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/AI-Native/);
  });
});

describe("checkReadme — shortcuts", () => {
  it("accepts a non-numeric claim", () => {
    expect(findingsFor({ shortcuts: "- **Shortcuts** — Every one customizable in Settings" })).toEqual([]);
  });

  it("accepts a numeric claim equal to the definition count", () => {
    expect(findingsFor({ shortcuts: "- **127 Shortcuts** — All customizable in Settings" })).toEqual([]);
  });

  it("flags a numeric claim that disagrees with the definition count", () => {
    const findings = findingsFor({ shortcuts: "- **122 Shortcuts** — All customizable in Settings" });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/122/);
    expect(findings[0]).toMatch(/127/);
  });

  it("flags a missing Shortcuts bullet", () => {
    const findings = findingsFor({ shortcuts: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Shortcuts/);
  });
});

describe("checkReadme — languages", () => {
  it("flags a count that disagrees with ALL_LANGUAGES", () => {
    const findings = findingsFor({
      languages: "- **2 Languages** — English · 简体中文 · Português (Brasil). Auto-detected on first launch.",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/\b2\b/);
    expect(findings[0]).toMatch(/\b3\b/);
  });

  it("flags a label that is not an ALL_LANGUAGES label, naming both sides of the diff", () => {
    const findings = findingsFor({
      languages: "- **3 Languages** — English · 简体中文 · Portuguese. Auto-detected on first launch.",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Português \(Brasil\)/);
    expect(findings[0]).toMatch(/Portuguese/);
  });

  it("flags a missing Languages bullet", () => {
    const findings = findingsFor({ languages: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Languages/);
  });
});

describe("checkReadme — themes", () => {
  it("flags the unqualified shape (no platform sentence) and says what shape is expected", () => {
    const findings = findingsFor({ themes: "- **3 Themes** — White, Paper, Night" });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/on macOS; Windows and Linux offer/);
  });

  it("flags a catalog theme missing from the macOS list", () => {
    const findings = findingsFor({
      themes: "- **3 Themes** — White, Night on macOS; Windows and Linux offer White and Night.",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Paper/i);
  });

  it("flags a Windows/Linux list that is not NON_MAC_THEME_IDS", () => {
    const findings = findingsFor({
      themes: "- **3 Themes** — White, Paper, Night on macOS; Windows and Linux offer White and Paper.",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Windows and Linux/);
    expect(findings[0]).toMatch(/Night/i);
  });

  it("flags a count that disagrees with the catalog", () => {
    const findings = findingsFor({
      themes: "- **6 Themes** — White, Paper, Night on macOS; Windows and Linux offer White and Night.",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/\b6\b/);
    expect(findings[0]).toMatch(/\b3\b/);
  });

  it("accepts a non-numeric themes claim", () => {
    expect(
      findingsFor({ themes: "- **Themes** — White, Paper, Night on macOS; Windows and Linux offer White and Night." }),
    ).toEqual([]);
  });

  it("flags a missing Themes bullet", () => {
    const findings = findingsFor({ themes: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Themes/);
  });
});

// ── run() ──────────────────────────────────────────────────────────────────

describe("run() against a fixture tree", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const PATHS = {
    readme: "R.md",
    providers: "p.rs",
    shortcuts: "s.ts",
    languages: "l.tsx",
    themes: "t.ts",
    themeAvailability: "a.ts",
  };

  function tree(overrides = {}) {
    const root = mkdtempSync(join(tmpdir(), "readme-claims-"));
    dirs.push(root);
    const files = {
      "R.md": readme({
        aiNative: "- **AI-Native** — MCP integration for Claude Desktop and Codex CLI.",
        languages: "- **3 Languages** — English · 简体中文 · Português (Brasil). Auto-detected.",
        themes: "- **4 Themes** — White, Paper, Mint, Night on macOS; Windows and Linux offer White and Night.",
        shortcuts: "- **3 Shortcuts** — All customizable in Settings",
        supported: "Supported: Claude Desktop, Codex CLI.",
      }),
      "p.rs": RUST,
      "s.ts": SHORTCUTS_TS,
      "l.tsx": TSX,
      "t.ts": THEMES_TS,
      "a.ts": AVAIL_TS,
      ...overrides,
    };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
    return root;
  }

  it("joins every registry to the README and reports zero findings on a consistent tree", async () => {
    const { findings, info } = await run({ root: tree(), paths: PATHS });
    expect(findings).toEqual([]);
    expect(info.join("\n")).toMatch(/2 MCP targets/);
    expect(info.join("\n")).toMatch(/3 shortcuts/);
  });

  it("turns an unparseable registry into a finding naming the file — never a silent pass", async () => {
    const { findings } = await run({ root: tree({ "p.rs": "// nothing here" }), paths: PATHS });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^p\.rs: /);
    expect(findings[0]).toMatch(/PROVIDERS/);
  });

  it("turns a missing README into a finding", async () => {
    const root = tree();
    rmSync(join(root, "R.md"));
    const { findings } = await run({ root, paths: PATHS });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^R\.md: /);
  });

  it("refuses to run without a root", async () => {
    await expect(run()).rejects.toThrow(/root/);
  });
});

// ── live tree ──────────────────────────────────────────────────────────────

describe("live tree", () => {
  const read = (rel) => readFileSync(resolve(REPO, rel), "utf8");

  it("exports the doc-join contract", () => {
    expect(id).toBe("readme-claims");
    expect(Object.keys(DEFAULT_PATHS).sort()).toEqual(
      ["languages", "providers", "readme", "shortcuts", "themeAvailability", "themes"],
    );
  });

  it("parses the real registries to the values the app exports", () => {
    const providers = parseProviders(read(DEFAULT_PATHS.providers));
    expect(providers.find((p) => p.name === "Gemini CLI")?.legacy).toBe(true);
    expect(providers.filter((p) => !p.legacy).map((p) => p.name)).toEqual(
      expect.arrayContaining(["Claude Desktop", "Claude Code", "Codex CLI", "Antigravity CLI"]),
    );
    expect(parseLanguages(read(DEFAULT_PATHS.languages)).map((l) => l.value)).toContain("pt-BR");
    expect(parseThemeIds(read(DEFAULT_PATHS.themes))).toEqual(Object.keys(themes));
    expect(parseNonMacThemeIds(read(DEFAULT_PATHS.themeAvailability))).toEqual([...NON_MAC_THEME_IDS]);
  });

  it("counts DEFAULT_SHORTCUTS entries, which `grep -c defaultKey` overstates", () => {
    const source = read(DEFAULT_PATHS.shortcuts);
    expect(countShortcutDefinitions(source)).toBe(DEFAULT_SHORTCUTS.length);
    // Three ShortcutDefinition members are named defaultKey*; a grep counts them as entries.
    expect((source.match(/defaultKey/g) ?? []).length).toBeGreaterThan(DEFAULT_SHORTCUTS.length);
  });

  it("reports zero findings against README.md", async () => {
    const { findings, info } = await run({ root: REPO });
    expect(findings).toEqual([]);
    expect(info.length).toBeGreaterThan(0);
  });
});
