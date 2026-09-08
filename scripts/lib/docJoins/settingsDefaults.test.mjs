// WI-FL0.4 — the settings-defaults doc join's own tests (gates tier, node).
//
// Fixture-driven: the parser, the renderers and `compare` are exercised on
// inline markdown and an injected defaults object, so a legitimate change to a
// shipped default does not turn this file red — the LIVE case at the bottom is
// the one that reads the real pages and the real defaults.ts, and it is the
// case that fails when the docs drift.
//
// The former `src/pages/settings/__tests__/terminalDocDefaults.test.ts` cases
// live here now (Codex objection #7): that file transcribed the terminal table
// by hand and so could not see a removed row. Its ranges half stayed behind as
// `terminalDocRanges.test.ts`.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  id,
  DEFAULT_PATHS,
  ROW_MAP,
  RENDERERS,
  parseTables,
  splitRow,
  stripMarkdown,
  defaultRows,
  renderDefault,
  validateRowMap,
  compare,
  lookup,
  defaultsFromSource,
  loadDefaults,
  run,
} from "./settingsDefaults.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TWO_TABLES = `
# Page

## Window

| Setting | Description | Default |
|---------|-------------|---------|
| Show filename | Display the name | Off |
| Also pair \`"\` | Typing \`"\` pairs | Off |

Prose between tables — with an em dash.

### Themes

| Theme | Background | Style |
|-------|-----------|-------|
| Paper | \`#EEEDED\` | Warm |

### Format support

| Toggle | Default | Enables |
|---|---|---|
| **Data formats** | Off | \`.json\`, \`.toml\` — a pipe \\| inside |

\`\`\`text
| not | a | table |
|-----|---|-------|
| in  | a | fence |
\`\`\`
`;

/** The real terminal.md Settings tables, verbatim, as of WI-FL0.4. */
const TERMINAL_DOC = `
## Settings

| Setting | Range | Default | Platforms |
|---------|-------|---------|-----------|
| Panel Size | 10 % – 80 % of the available space, in 5 % steps | 40 % | All |
| Font Size | 10 – 24 px | 13 px | All |
| Line Height | 1.0 – 2.0 | 1.2 | All |
| Copy on Select | On / Off | Off | All |
| Mac Option as Meta | On / Off | On | macOS |
| Shell Integration | On / Off | On | macOS / Linux (zsh, bash) |
| Remote Clipboard (OSC 52) | On / Off | On | All |
| Scrollback | 1,000 / 5,000 / 10,000 / 50,000 lines | 5,000 | All |
| Screen Reader Mode | On / Off | Off | All |

### Accessibility

| Setting | Options | Default |
|---------|---------|---------|
| Terminal bell | Off / Visual / Audible | Visual |
| Minimum contrast | Off / WCAG AA (4.5:1) / WCAG AAA (7:1) / Maximum | WCAG AA (4.5:1) |
`;

/** What defaults.ts ships for the terminal section — the former transcription's `documented` column. */
const TERMINAL_DEFAULTS = {
  terminal: {
    panelRatio: 0.4,
    fontSize: 13,
    lineHeight: 1.2,
    copyOnSelect: false,
    macOptionIsMeta: true,
    shellIntegration: true,
    osc52Clipboard: true,
    scrollback: 5000,
    screenReaderMode: false,
    bellMode: "visual",
    minimumContrastRatio: 4.5,
  },
};

const TERMINAL_MAP = ROW_MAP.filter((e) => e.page === "terminal");

function pagesFrom({ settings = "", terminal = "" }) {
  return { settings: parseTables(settings), terminal: parseTables(terminal) };
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

describe("module contract", () => {
  it("exports the doc-join id and default paths the runner expects", () => {
    expect(id).toBe("settings-defaults");
    expect(DEFAULT_PATHS).toMatchObject({
      settingsDoc: "website/guide/settings.md",
      terminalDoc: "website/guide/terminal.md",
      defaults: "src/stores/settingsStore/defaults.ts",
    });
  });

  it("ships a ROW_MAP that validates against its own rules", () => {
    expect(validateRowMap(ROW_MAP)).toEqual([]);
    expect(ROW_MAP.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Table parser
// ---------------------------------------------------------------------------

describe("parseTables", () => {
  it("finds every table on a page, with its heading and line numbers", () => {
    const tables = parseTables(TWO_TABLES);
    expect(tables.map((t) => t.heading)).toEqual(["Window", "Themes", "Format support"]);
    expect(tables[0].headers).toEqual(["Setting", "Description", "Default"]);
    // The fixture opens with a newline, so `# Page` is line 2 and the first header row line 6.
    expect(tables[0].rows.map((r) => r.line)).toEqual([8, 9]);
    expect(tables[0].line).toBe(6);
    expect(tables[2].rows).toHaveLength(1);
  });

  it("keeps inline markdown in cells and unescapes a \\| pipe", () => {
    const [, , formats] = parseTables(TWO_TABLES);
    const row = formats.rows[0];
    expect(row.cells[0]).toBe("**Data formats**");
    expect(row.cells).toHaveLength(3);
    expect(row.cells[2]).toBe("`.json`, `.toml` — a pipe | inside");
  });

  it("keeps a cell whose text contains inline code with quotes", () => {
    const [window] = parseTables(TWO_TABLES);
    expect(window.rows[1].cells[0]).toBe('Also pair `"`');
  });

  it("does not read a table out of a fenced code block", () => {
    const tables = parseTables(TWO_TABLES);
    expect(tables.some((t) => t.rows.some((r) => r.cells.includes("fence")))).toBe(false);
  });

  it("needs a delimiter row — a lone pipe line is prose", () => {
    expect(parseTables("| just | a | line |\nno delimiter\n")).toEqual([]);
  });

  it("splitRow preserves an empty trailing cell", () => {
    expect(splitRow("| a | |")).toEqual(["a", ""]);
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("stops a table at the first non-table line", () => {
    const tables = parseTables("| A | Default |\n|---|---|\n| x | On |\nprose\n| y | Off |\n");
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(1);
  });
});

describe("stripMarkdown", () => {
  it.each([
    ["**Data formats**", "Data formats"],
    ["_(empty)_", "(empty)"],
    ["*Standard*", "Standard"],
    ['Also pair `"`', 'Also pair "'],
    ["Show `<br>` tags", "Show <br> tags"],
    ["`obsidian`, `vscode`, `dict`, `x-dictionary`", "obsidian, vscode, dict, x-dictionary"],
    ["Curly `\"\"` `''`", "Curly \"\" ''"],
    ["LF (`\\n`)", "LF (\\n)"],
    ["[Markdown Lint](/guide/lint)", "Markdown Lint"],
    ["snake_case_name stays", "snake_case_name stays"],
    ["  spaced   out  ", "spaced out"],
    ["a \\* literal", "a * literal"],
  ])("%j → %j", (input, expected) => {
    expect(stripMarkdown(input)).toBe(expected);
  });
});

describe("defaultRows", () => {
  it("ignores tables without a Default column and reads the Default cell from any position", () => {
    const rows = defaultRows(parseTables(TWO_TABLES));
    expect(rows.map((r) => r.row)).toEqual(["Show filename", 'Also pair "', "Data formats"]);
    expect(rows.map((r) => r.docDefault)).toEqual(["Off", "Off", "Off"]);
    expect(rows[2].heading).toBe("Format support");
  });
});

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

describe("renderers", () => {
  it.each([
    ["onOff", true, "settings", "On"],
    ["onOff", false, "terminal", "Off"],
    ["number", 1.2, "terminal", "1.2"],
    ["number", 0.9, "settings", "0.9"],
    ["seconds", 30, "settings", "30 seconds"],
    ["px", 13, "settings", "13px"],
    ["px", 13, "terminal", "13 px"],
    ["percent", 0.4, "settings", "40%"],
    ["percent", 0.4, "terminal", "40 %"],
    ["thousands", 5000, "settings", "5,000"],
    ["text", "", "settings", "(empty)"],
    ["text", "kbd", "settings", "kbd"],
    ["list", ["obsidian", "vscode"], "settings", "obsidian, vscode"],
  ])("%s(%j) on %s → %j", (name, value, page, expected) => {
    expect(renderDefault(name, value, page)).toBe(expected);
    expect(RENDERERS[name]).toBeTypeOf("function");
  });

  it("renders an enum through the explicit value→label map and refuses an unmapped value", () => {
    const render = { enum: { visual: "Visual", off: "Off" } };
    expect(renderDefault(render, "visual", "settings")).toBe("Visual");
    expect(() => renderDefault(render, "audible", "settings")).toThrow(/no label for value "audible"/);
  });

  it("renders a unit suffix, with an explicit label for zero", () => {
    expect(renderDefault({ suffix: " versions" }, 50, "settings")).toBe("50 versions");
    expect(renderDefault({ suffix: " KB", zero: "Unlimited" }, 0, "settings")).toBe("Unlimited");
    expect(renderDefault({ suffix: " KB", zero: "Unlimited" }, 512, "settings")).toBe("512 KB");
  });

  it("refuses a value of the wrong type rather than coercing it", () => {
    expect(() => renderDefault("onOff", "true", "settings")).toThrow(/expects a boolean/);
    expect(() => renderDefault("px", "13", "settings")).toThrow(/expects a number/);
    expect(() => renderDefault("list", "a, b", "settings")).toThrow(/expects an array/);
    expect(() => renderDefault("nope", 1, "settings")).toThrow(/unknown renderer/);
  });
});

describe("lookup", () => {
  it("walks a dotted key and returns undefined for a missing leaf, never a prototype property", () => {
    const defaults = { advanced: { mcpServer: { autoStart: true } } };
    expect(lookup(defaults, "advanced.mcpServer.autoStart")).toBe(true);
    expect(lookup(defaults, "advanced.mcpServer.port")).toBeUndefined();
    expect(lookup(defaults, "advanced.constructor")).toBeUndefined();
    expect(lookup(defaults, "nothing.here")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// compare — both directions, fail closed
// ---------------------------------------------------------------------------

describe("compare", () => {
  const doc = `
## Saving

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Enable auto-save | Save | On | On / Off |
| Save interval | Wait | 30 seconds | 10s, 30s |

| Option | Result |
|---|---|
| **Split** (default) | Side by side |
`;
  const defaults = { general: { autoSaveEnabled: true, autoSaveInterval: 30 } };
  const map = [
    { page: "settings", row: "Enable auto-save", key: "general.autoSaveEnabled", render: "onOff" },
    { page: "settings", row: "Save interval", key: "general.autoSaveInterval", render: "seconds" },
  ];

  it("is clean when every Default row is mapped and every rendered default matches", () => {
    const { findings, info } = compare(pagesFrom({ settings: doc }), defaults, map);
    expect(findings).toEqual([]);
    expect(info).toEqual(["settings.md: 2 Default rows, 2 mapped", "terminal.md: 0 Default rows, 0 mapped", "2 defaults compared"]);
  });

  it("reports a mismatch naming page, line, row, doc value and code value", () => {
    const drifted = { general: { autoSaveEnabled: false, autoSaveInterval: 30 } };
    const { findings } = compare(pagesFrom({ settings: doc }), drifted, map);
    expect(findings).toEqual([
      'settings.md:6 "Enable auto-save": doc says "On", code (general.autoSaveEnabled) says "Off"',
    ]);
  });

  it("reports a mapped row the page no longer documents", () => {
    const { findings } = compare(pagesFrom({ settings: doc }), defaults, [
      ...map,
      { page: "settings", row: "Auto-hide status bar", key: "appearance.autoHideStatusBar", render: "onOff" },
    ]);
    expect(findings).toEqual([
      'settings.md: mapped row "Auto-hide status bar" is not documented — add the row, or drop the map entry',
    ]);
  });

  it("fails closed on a Default row that is not in the map", () => {
    const { findings } = compare(pagesFrom({ settings: doc }), defaults, map.slice(0, 1));
    expect(findings).toEqual([
      'settings.md:7 "Save interval" has a Default cell ("30 seconds") but no ROW_MAP entry — map it, or mark it { notASetting: reason }',
    ]);
  });

  it("ignores a table without a Default column instead of reporting its rows as unmapped", () => {
    const { findings } = compare(pagesFrom({ settings: doc }), defaults, map);
    expect(findings.some((f) => f.includes("Split"))).toBe(false);
  });

  it("reports a key that defaults.ts does not have", () => {
    const { findings } = compare(pagesFrom({ settings: doc }), { general: { autoSaveEnabled: true } }, map);
    expect(findings).toEqual(['settings.md:7 "Save interval": key general.autoSaveInterval is not in defaults.ts']);
  });

  it("reports a value the renderer cannot express instead of guessing", () => {
    const { findings } = compare(pagesFrom({ settings: doc }), defaults, [
      map[0],
      { page: "settings", row: "Save interval", key: "general.autoSaveInterval", render: { enum: { 10: "10s" } } },
    ]);
    expect(findings).toEqual([
      'settings.md:7 "Save interval": cannot render general.autoSaveInterval = 30 — no label for value "30" in the enum map',
    ]);
  });

  it("pins a dynamic default with { expected, reason } and claims a non-setting with { notASetting }", () => {
    const page = `
| Setting | Description | Default |
|---|---|---|
| Language | UI language | English |
| Check Now | Trigger a check | — |
`;
    const pinned = [
      { page: "settings", row: "Language", key: "general.language", render: { expected: "English", reason: "auto-detected" } },
      { page: "settings", row: "Check Now", render: { notASetting: "an action button" } },
    ];
    expect(compare(pagesFrom({ settings: page }), { general: { language: "zh-CN" } }, pinned).findings).toEqual([]);
    const { findings } = compare(pagesFrom({ settings: page.replace("| English |", "| Auto |") }), {}, pinned);
    expect(findings).toEqual(['settings.md:4 "Language": doc says "Auto", the map pins "English" (auto-detected)']);
  });

  it("refuses a bare { expected } or { notASetting } without a reason, and a duplicate entry", () => {
    const findings = validateRowMap([
      { page: "settings", row: "Language", render: { expected: "English" } },
      { page: "settings", row: "Check Now", render: { notASetting: "" } },
      { page: "settings", row: "X", render: "onOff" },
      { page: "settings", row: "Y", key: "a.b", render: "onOff" },
      { page: "settings", row: "Y", key: "a.b", render: "onOff" },
      { page: "elsewhere", row: "Z", key: "a.b", render: "onOff" },
    ]);
    expect(findings).toEqual([
      'ROW_MAP[0] "Language": { expected } needs a reason',
      'ROW_MAP[1] "Check Now": { notASetting } needs a reason',
      'ROW_MAP[2] "X": key is required unless the row is { expected } or { notASetting }',
      'ROW_MAP[4] "Y": duplicate entry for settings',
      "ROW_MAP[5]: page must be one of settings/terminal",
    ]);
  });

  it("disambiguates a row text that appears in two tables by heading, and asks for one otherwise", () => {
    const page = `
### Typography

| Setting | Description | Default |
|---|---|---|
| Font Size | Editor | 18px |

## Terminal

| Setting | Description | Default |
|---|---|---|
| Font Size | Terminal | 13px |
`;
    const d = { appearance: { fontSize: 18 }, terminal: { fontSize: 13 } };
    const ambiguous = [{ page: "settings", row: "Font Size", key: "appearance.fontSize", render: "px" }];
    expect(compare(pagesFrom({ settings: page }), d, ambiguous).findings[0]).toMatch(
      /"Font Size" appears in 2 tables \(lines 6, 12\) — add `heading`/,
    );
    const resolved = [
      { page: "settings", heading: "Typography", row: "Font Size", key: "appearance.fontSize", render: "px" },
      { page: "settings", heading: "Terminal", row: "Font Size", key: "terminal.fontSize", render: "px" },
    ];
    expect(compare(pagesFrom({ settings: page }), d, resolved).findings).toEqual([]);
  });

  it("names the real files when given labels", () => {
    const { findings } = compare(pagesFrom({ settings: doc }), defaults, map.slice(0, 1), {
      settings: "website/guide/settings.md",
    });
    expect(findings[0].startsWith("website/guide/settings.md:7")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The former terminalDocDefaults cases, against the real terminal ROW_MAP
// ---------------------------------------------------------------------------

describe("terminal.md Default column ↔ defaults (formerly terminalDocDefaults.test.ts)", () => {
  it("maps all eleven published terminal rows and finds them all correct against the shipped defaults", () => {
    expect(TERMINAL_MAP).toHaveLength(11);
    const { findings, info } = compare(pagesFrom({ terminal: TERMINAL_DOC }), TERMINAL_DEFAULTS, TERMINAL_MAP);
    expect(findings).toEqual([]);
    expect(info).toContain("terminal.md: 11 Default rows, 11 mapped");
  });

  it("catches T9 — Option-as-Meta documented Off while the code ships true", () => {
    const doc = TERMINAL_DOC.replace("| Mac Option as Meta | On / Off | On |", "| Mac Option as Meta | On / Off | Off |");
    const { findings } = compare(pagesFrom({ terminal: doc }), TERMINAL_DEFAULTS, TERMINAL_MAP);
    expect(findings).toEqual([
      'terminal.md:10 "Mac Option as Meta": doc says "Off", code (terminal.macOptionIsMeta) says "On"',
    ]);
  });

  it("catches a REMOVED row, which the transcription never could", () => {
    const doc = TERMINAL_DOC.replace(/^\| Remote Clipboard \(OSC 52\).*\n/m, "");
    const { findings } = compare(pagesFrom({ terminal: doc }), TERMINAL_DEFAULTS, TERMINAL_MAP);
    expect(findings).toEqual([
      'terminal.md: mapped row "Remote Clipboard (OSC 52)" is not documented — add the row, or drop the map entry',
    ]);
  });

  it("catches an ADDED row that nobody mapped", () => {
    const doc = TERMINAL_DOC.replace("| Scrollback |", "| Cursor Blink | On / Off | On | All |\n| Scrollback |");
    const { findings } = compare(pagesFrom({ terminal: doc }), TERMINAL_DEFAULTS, TERMINAL_MAP);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/"Cursor Blink" has a Default cell \("On"\) but no ROW_MAP entry/);
  });

  it("renders the terminal page's units with a space, as that page writes them", () => {
    const byRow = Object.fromEntries(TERMINAL_MAP.map((e) => [e.row, e]));
    expect(renderDefault(byRow["Panel Size"].render, 0.4, "terminal")).toBe("40 %");
    expect(renderDefault(byRow["Font Size"].render, 13, "terminal")).toBe("13 px");
    expect(renderDefault(byRow["Minimum contrast"].render, 4.5, "terminal")).toBe("WCAG AA (4.5:1)");
    expect(renderDefault(byRow["Scrollback"].render, 5000, "terminal")).toBe("5,000");
  });
});

// ---------------------------------------------------------------------------
// Loading defaults.ts
// ---------------------------------------------------------------------------

describe("defaultsFromSource (textual fallback)", () => {
  const source = `
export const initialState: SettingsState = {
  general: {
    autoSaveInterval: 30,
    language: resolveInitialLanguage(),
  },
  cjkFormatting: { ...DEFAULT_CJK_FORMATTING },
  advanced: {
    mcpServer: {
      autoStart: true, // comment
    },
    customLinkProtocols: ["obsidian", "vscode"],
  },
  showDevSection: true,
};
`;
  it("builds the nested object from the dotted literals and spreads the CJK defaults in", () => {
    const d = defaultsFromSource(source, { quoteStyle: "curly" });
    expect(d.general.autoSaveInterval).toBe(30);
    expect(d.advanced.mcpServer.autoStart).toBe(true);
    expect(d.advanced.customLinkProtocols).toEqual(["obsidian", "vscode"]);
    expect(d.cjkFormatting).toEqual({ quoteStyle: "curly" });
    expect(d.showDevSection).toBe(true);
  });

  it("marks a non-literal initialiser as unresolved so a renderer fails loudly on it", () => {
    const d = defaultsFromSource(source, {});
    expect(d.general.language).toEqual({ unresolved: "resolveInitialLanguage()" });
    expect(() => renderDefault("text", d.general.language, "settings")).toThrow(/expects a string/);
  });
});

describe("loadDefaults", () => {
  it("executes the real defaults.ts through tsx and reports that it did", async () => {
    const { defaults, via } = await loadDefaults(REPO_ROOT, DEFAULT_PATHS);
    expect(via).toMatch(/^executed src\/stores\/settingsStore\/defaults\.ts via tsx$/);
    expect(defaults.terminal.macOptionIsMeta).toBe(true);
    expect(defaults.cjkFormatting.quoteStyle).toBe("curly");
    expect(typeof defaults.general.language).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// run — fixtures on disk, injected defaults; then the live tree
// ---------------------------------------------------------------------------

describe("run", () => {
  it("reads both pages under root, uses injected defaults and a caller's row map, and reports where defaults came from", async () => {
    const root = mkdtempSync(join(tmpdir(), "settings-defaults-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/settings.md"), "| Setting | Default |\n|---|---|\n| Confirm quit | On |\n");
    writeFileSync(join(root, "docs/terminal.md"), TERMINAL_DOC);
    const paths = { settingsDoc: "docs/settings.md", terminalDoc: "docs/terminal.md", defaults: "unused.ts" };
    const defaults = { ...TERMINAL_DEFAULTS, general: { confirmQuit: false } };
    const rowMap = [
      ...TERMINAL_MAP,
      { page: "settings", row: "Confirm quit", key: "general.confirmQuit", render: "onOff" },
    ];
    const { findings, info } = await run({ root, paths, deps: { defaults, rowMap } });
    expect(findings).toEqual(['docs/settings.md:3 "Confirm quit": doc says "On", code (general.confirmQuit) says "Off"']);
    expect(info).toContain("defaults: injected by the caller");
    expect(info).toContain("docs/terminal.md: 11 Default rows, 11 mapped");
  });

  it("LIVE: settings.md and terminal.md agree with defaults.ts in both directions", async () => {
    const { findings, info } = await run({ root: REPO_ROOT });
    expect(findings, findings.join("\n")).toEqual([]);
    expect(info).toContain("defaults: executed src/stores/settingsStore/defaults.ts via tsx");
    const rows = Object.fromEntries(
      info
        .map((line) => /^(website\/guide\/\w+\.md): (\d+) Default rows, (\d+) mapped$/.exec(line))
        .filter(Boolean)
        .map((m) => [m[1], { rows: Number(m[2]), mapped: Number(m[3]) }]),
    );
    expect(rows["website/guide/terminal.md"]).toEqual({ rows: 11, mapped: 11 });
    expect(rows["website/guide/settings.md"].rows).toBeGreaterThan(100);
    expect(rows["website/guide/settings.md"].mapped).toBe(rows["website/guide/settings.md"].rows);
  });

  it("LIVE: every ROW_MAP key resolves in the shipped defaults", async () => {
    const { defaults } = await loadDefaults(REPO_ROOT, DEFAULT_PATHS);
    const missing = ROW_MAP.filter((e) => e.key && lookup(defaults, e.key) === undefined).map((e) => e.key);
    expect(missing).toEqual([]);
  });
});
