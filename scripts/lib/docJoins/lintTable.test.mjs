// WI-FL0.3 — the lint-table doc join: website/guide/lint.md against RULE_META
// and the lint shortcut defaults. The module is a library the doc-joins runner
// imports, not a CLI, so it is exercised IN-PROCESS against fixture trees in
// tmpdir with injected `deps`, plus one live run against the real tree and one
// subprocess check that loading it has no side effects — the property that
// forced the renderer's extraction out of check-keybinding-manifest.mjs, which
// runs its whole gate at import time.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_PATHS, id, leadingTitle, run } from "./lintTable.mjs";
import { prosemirrorToDocs } from "../keybindingFormat.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const MODULE_URL = pathToFileURL(join(HERE, "lintTable.mjs")).href;

/** A small RULE_META stand-in: one of each severity, one M and one Y id. */
const META = [
  { id: "E01", severity: "error", title: "Undefined reference" },
  { id: "E05", severity: "warning", title: "Space inside emphasis markers" },
  { id: "M001", severity: "error", title: "Image file not found at the local path" },
  { id: "Y002", severity: "warning", title: "YAML parse warning" },
];

/** Doc rows that agree with META, keyed by id so a test can perturb one. */
const ROWS = {
  E01: "| **E01** | Error | Undefined reference: `[link][missing]` points to a definition that doesn't exist |",
  E05: "| **E05** | Warning | Space inside emphasis markers — `* word *` won't render as italic |",
  M001: "| **M001** | Error | Image file not found at the local path |",
  Y002: "| **Y002** | Warning | YAML parse warning (for YAML files) |",
};

/** The three lint shortcuts, in the shape shortcutDefinitions.ts declares them (loaded through tsx). */
const SHORTCUTS_TS = `export const DEFAULT_SHORTCUTS = [
  { id: "validateMarkdown", label: "Check Markdown", category: "view", defaultKey: "Alt-Mod-v", menuId: "check-markdown" },
  { id: "lintNext", label: "Next Issue", category: "view", defaultKey: "F2", menuId: "lint-next" },
  { id: "lintPrev", label: "Previous Issue", category: "view", defaultKey: "Shift-F2", menuId: "lint-prev" },
];
`;

/** A stand-in renderer with the docs' shape, so fixtures never touch the disk-loaded one. */
const renderShortcut = (key) =>
  key
    .split("-")
    .map((t) => (t.length === 1 ? t.toUpperCase() : t))
    .join(" + ");

function doc({
  rows = Object.values(ROWS),
  trigger = "`Alt + Mod + V`",
  intro = "Lint runs on demand (`Alt + Mod + V` or **Tools → Check Markdown**).",
  tail = "",
} = {}) {
  return [
    "# Markdown Lint",
    "",
    intro,
    "",
    "## Rule Reference",
    "",
    "| Rule ID | Severity | Description |",
    "|---------|----------|-------------|",
    ...rows,
    "",
    "## Triggering lint",
    "",
    "| Trigger | Action |",
    "|---|---|",
    `| ${trigger} | Run lint on the active document |`,
    "| **Tools → Check Markdown** | Same as the shortcut |",
    "| `F2` | Jump to the next diagnostic |",
    "| `Shift + F2` | Jump to the previous diagnostic |",
    "",
    tail,
    "",
  ].join("\n");
}

const trees = [];
afterAll(() => {
  for (const t of trees) rmSync(t, { recursive: true, force: true });
});

/** A fixture repo root holding the doc and the shortcut definitions at their DEFAULT_PATHS. */
function tree(markdown, shortcutsTs = SHORTCUTS_TS) {
  const root = mkdtempSync(join(tmpdir(), "lint-table-"));
  trees.push(root);
  for (const [rel, text] of [
    [DEFAULT_PATHS.lintDoc, markdown],
    [DEFAULT_PATHS.shortcuts, shortcutsTs],
  ]) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

async function joinDoc(markdown, { shortcutsTs, deps } = {}) {
  return run({ root: tree(markdown, shortcutsTs), deps: { ruleMeta: META, renderShortcut, ...deps } });
}

describe("lint-table doc join — contract", () => {
  it("exposes the runner contract, and every default path exists in the repo", () => {
    expect(id).toBe("lint-table");
    expect(Object.keys(DEFAULT_PATHS).sort()).toEqual(["keybindingScript", "lintDoc", "ruleMeta", "shortcuts"]);
    for (const rel of Object.values(DEFAULT_PATHS)) expect(existsSync(join(REPO_ROOT, rel)), rel).toBe(true);
  });

  it("loading the module runs nothing — no gate output on stdout, no exit", () => {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(MODULE_URL)});`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(out).toBe("");
  });
});

describe("leadingTitle — the description up to the first ` — `, `: ` or ` (`", () => {
  it.each([
    ["Undefined reference: `[link][missing]` points to a definition that doesn't exist", "Undefined reference"],
    ["Reversed link — looks like `(text)[url]` instead of `[text](url)`", "Reversed link"],
    ["Heading level skipped (h2 expected, found h3)", "Heading level skipped"],
    ["ATX heading missing space after `#` (e.g., `##Heading` should be `## Heading`)", "ATX heading missing space after `#`"],
    ["Duplicate link reference definition (same `[label]:` appears twice)", "Duplicate link reference definition"],
    ["Image file not found at the local path", "Image file not found at the local path"],
    ["  padded  ", "padded"],
  ])("%j → %j", (description, title) => {
    expect(leadingTitle(description)).toBe(title);
  });
});

describe("lint-table doc join — rule table", () => {
  it("is silent on a doc that agrees with the code, and says what it joined", async () => {
    const { findings, info } = await joinDoc(doc());
    expect(findings).toEqual([]);
    expect(info.join("\n")).toContain("4 documented rules");
    expect(info.join("\n")).toContain("validateMarkdown → Alt + Mod + V");
  });

  it("reports a severity that disagrees with the code — once, naming both", async () => {
    const rows = Object.values({ ...ROWS, E05: ROWS.E05.replace("| Warning |", "| Error |") });
    const { findings } = await joinDoc(doc({ rows }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/E05 severity is "Error"/);
    expect(findings[0]).toContain("Warning");
  });

  it("reports a rule the code has and the doc does not", async () => {
    const rows = Object.values(ROWS).filter((r) => !r.includes("M001"));
    const { findings } = await joinDoc(doc({ rows }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/M001 .*has no row/);
  });

  it("reports a documented rule the code does not have", async () => {
    const rows = [...Object.values(ROWS), "| **Z999** | Error | Phantom rule |"];
    const { findings } = await joinDoc(doc({ rows }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/Z999 is documented but .*no such rule/);
  });

  it("reports a description whose leading title is not the rule's title", async () => {
    const rows = Object.values({ ...ROWS, E01: ROWS.E01.replace("Undefined reference:", "Undefined link:") });
    const { findings } = await joinDoc(doc({ rows }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/E01 title is "Undefined link"/);
    expect(findings[0]).toContain('"Undefined reference"');
  });

  it("reports an id cell that is not bold without cascading into a missing-row finding", async () => {
    const rows = Object.values({ ...ROWS, E01: ROWS.E01.replace("**E01**", "E01") });
    const { findings } = await joinDoc(doc({ rows }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/E01.*not bold/);
  });

  it("reports a rule documented twice", async () => {
    const { findings } = await joinDoc(doc({ rows: [...Object.values(ROWS), ROWS.E01] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/E01 is documented twice/);
  });

  it("fails closed when the rule table is missing", async () => {
    const { findings } = await joinDoc("# Markdown Lint\n\nNo tables here.\n");
    expect(findings.some((f) => /no .*Rule ID.*table/.test(f))).toBe(true);
  });
});

describe("lint-table doc join — trigger", () => {
  it("reports a trigger row without the validateMarkdown default, and each stale chord in it", async () => {
    const { findings } = await joinDoc(doc({ trigger: "`Cmd + Shift + L` (macOS) / `Ctrl + Shift + L` (Win/Linux)" }));
    expect(findings.some((f) => /"Run lint on the active document" trigger is .*Alt \+ Mod \+ V/.test(f))).toBe(true);
    expect(findings.filter((f) => f.includes("stale chord"))).toHaveLength(2);
    expect(findings).toHaveLength(3);
  });

  it("reports a stale chord anywhere on the page — bare prose and code spans alike", async () => {
    const { findings } = await joinDoc(
      doc({
        intro: "Lint runs on demand (Cmd-Shift-L or **Tools → Check Markdown**).",
        tail: "For YAML files the same `Cmd-Shift-L` shortcut populates the badge.",
      }),
    );
    expect(findings).toHaveLength(2);
    for (const f of findings) expect(f).toMatch(/stale chord "Cmd-Shift-L"/);
    expect(findings[0]).toContain("`Alt + Mod + V`");
  });

  it("does not mistake ordinary code spans or prose for chords", async () => {
    const { findings } = await joinDoc(
      doc({
        tail: "Not chords: `prettier --check`, `3 * 4 * 5`, `x - y`, `-`, `[label]:`, `##Heading`, alt-text, Shift-click, `#section`, h1 → h3, an open ```` ``` ```` fence.",
      }),
    );
    expect(findings).toEqual([]);
  });

  it("uses the injected renderer rather than the disk-loaded one", async () => {
    const { findings } = await joinDoc(doc(), { deps: { renderShortcut: () => "INJECTED" } });
    expect(findings.some((f) => f.includes("`INJECTED`"))).toBe(true);
  });

  // audit R2 #146 — the page-side spelling of a chord was produced by a COPY
  // of `prosemirrorToDocs`'s rule, and the copy had drifted: it upper-cased a
  // single ASCII letter (`length === 1 && /[a-z]/i`), while the renderer
  // upper-cases any single Unicode LETTER by CODE POINT (`/^\p{L}$/u` — audit
  // 20260907 #91 fixed the renderer and not the copy).
  //
  // The visible consequence is an ALPHABET-DEPENDENT gate: a prose chord
  // written in lower case is normalised and accepted for `v`, and reported
  // stale for `é` or an astral letter, on the same page under the same rule.
  // Both sides go through the one renderer now, so the alphabet stops
  // mattering. The `v` row is the control.
  it.each([
    ["ASCII (the control — always worked)", "Alt-Mod-v", "v"],
    ["a non-ASCII letter", "Alt-Mod-é", "é"],
    ["an astral letter — two UTF-16 units, one code point", "Alt-Mod-𐐨", "𐐨"],
  ])("accepts a lower-case prose chord for %s", async (_label, defaultKey, lower) => {
    const written = prosemirrorToDocs(defaultKey);
    expect(written).toBe(`Alt + Mod + ${lower.toUpperCase()}`);
    const shortcutsTs = SHORTCUTS_TS.replace('defaultKey: "Alt-Mod-v"', `defaultKey: ${JSON.stringify(defaultKey)}`);
    const { findings } = await joinDoc(
      doc({
        trigger: `\`${written}\``,
        intro: `Lint runs on demand (\`Alt + Mod + ${lower}\` or **Tools → Check Markdown**).`,
      }),
      { shortcutsTs, deps: { renderShortcut: prosemirrorToDocs } },
    );
    expect(findings).toEqual([]);
  });

  it("fails closed when a lint shortcut id is missing from the definitions", async () => {
    const { findings } = await joinDoc(doc(), { shortcutsTs: "export const DEFAULT_SHORTCUTS = [];\n" });
    expect(findings.some((f) => /no shortcut definition with id "validateMarkdown"/.test(f))).toBe(true);
  });

  it("does not read a code span with a stray dash as a chord — keyTokens refusing it means 'not a chord'", async () => {
    // `keyTokens` throws on `prettier --check` (an empty token that is not the
    // minus key); on a guide page that is a shell command, not a shortcut.
    const { findings } = await joinDoc(doc({ tail: "\nRun `prettier --check` first; `-x` and `Mod--Shift-A` are not chords either.\n" }));
    expect(findings).toEqual([]);
  });

  it("refuses a documented chord for a shortcut that is unbound by default", async () => {
    const shortcutsTs = SHORTCUTS_TS.replace('defaultKey: "Alt-Mod-v"', 'defaultKey: ""');
    const { findings } = await joinDoc(doc(), { shortcutsTs });
    expect(findings.some((f) => /validateMarkdown is unbound by default/.test(f))).toBe(true);
  });

  // audit R2 #141 — the bare-prose matcher listed only `F\d` and one character,
  // so a stale chord ending in a NAMED key was invisible to it.
  it("sees a stale bare-prose chord whose key has a name (Enter, PageDown)", async () => {
    const { findings } = await joinDoc(doc({ tail: "\nPress Cmd + Enter to run it, or Alt + PageDown to skip.\n" }));
    expect(findings.some((f) => /stale chord "Cmd \+ Enter"/.test(f))).toBe(true);
    expect(findings.some((f) => /stale chord "Alt \+ PageDown"/.test(f))).toBe(true);
  });

  // audit R2 #145 — `keyTokens` does not trim, so a spaced hyphen chord had
  // tokens like "Cmd " that matched no modifier and read as "not a chord".
  it("sees a stale hyphen chord written with spaces around the separator", async () => {
    const { findings } = await joinDoc(doc({ tail: "\nThe old binding was Cmd - Shift - L.\n" }));
    expect(findings.some((f) => /stale chord "Cmd - Shift - L"/.test(f))).toBe(true);
  });

  // audit R2 #147 — a boolean toggle let a `~~~` line inside a ``` block close
  // it, so the rest of the block was read as prose.
  it("keeps a fenced block closed against a different marker and a shorter run", async () => {
    const tail = ["```text", "~~~", "``", "Cmd + Shift + L", "```", "", "Cmd + Shift + K"].join("\n");
    const { findings } = await joinDoc(doc({ tail }));
    expect(findings.some((f) => /stale chord "Cmd \+ Shift \+ L"/.test(f))).toBe(false);
    expect(findings.some((f) => /stale chord "Cmd \+ Shift \+ K"/.test(f))).toBe(true);
  });

  // audit R2 #149 — `cells[1]` matched on a malformed row, and `find` took an
  // arbitrary one of two rows documenting the same action.
  it("reports a trigger row that is not two cells, and a duplicated action", async () => {
    const markdown = doc().replace(
      "| `F2` | Jump to the next diagnostic |",
      "| `F2` | Jump to the next diagnostic | extra |\n| `F2` | Jump to the previous diagnostic |",
    );
    const { findings } = await joinDoc(markdown);
    expect(findings.some((f) => /expected 2 cells in the trigger table, found 3/.test(f))).toBe(true);
    expect(findings.some((f) => /documents "Jump to the previous diagnostic" twice/.test(f))).toBe(true);
  });
});

describe("lint-table doc join — source validation", () => {
  // audit R2 #150 — `byId` keeps the last of two entries sharing an id, and
  // the completeness loop then reports BOTH as documented.
  it("refuses RULE_META that declares one id twice", async () => {
    const dup = [...META, { id: "E01", severity: "warning", title: "Something else" }];
    await expect(joinDoc(doc(), { deps: { ruleMeta: dup } })).rejects.toThrow(/declares "E01" twice/);
  });

  // audit R2 #151 — `find` picks an arbitrary one of two definitions sharing
  // an id, and a non-string key reaches the renderer as whatever it is.
  it("refuses duplicate or non-string shortcut definitions for a consumed id", async () => {
    const dup = SHORTCUTS_TS.replace(
      "];\n",
      '  { id: "lintNext", label: "Next Issue", category: "view", defaultKey: "F3", menuId: "lint-next" },\n];\n',
    );
    await expect(joinDoc(doc(), { shortcutsTs: dup })).rejects.toThrow(/declares "lintNext" 2 times/);
    const bad = SHORTCUTS_TS.replace('defaultKey: "F2"', "defaultKey: 2");
    await expect(joinDoc(doc(), { shortcutsTs: bad })).rejects.toThrow(/"lintNext"\.defaultKey is 2, not a key string/);
  });

  // audit R2 #143 — GFM requires the delimiter row to have the header's cell
  // count; without that a pipe line followed by a shorter dash line was read
  // as a table nothing renders as one.
  it("does not read a table whose delimiter row has a different cell count", async () => {
    const markdown = doc().replace("|---------|----------|-------------|", "|---------|----------|");
    const { findings } = await joinDoc(markdown);
    expect(findings.some((f) => /no `\| Rule ID \| Severity \| Description \|` table found/.test(f))).toBe(true);
  });

  // audit R2 #142 — a backslash escapes exactly the character after it, so an
  // EVEN run before a `|` leaves a real delimiter. Reading every `\|` as an
  // escape merged the two cells after it into one, and the row then reported
  // the wrong arity instead of joining.
  it("treats a doubled backslash before a pipe as a delimiter, not an escape", async () => {
    const escaped = "| **E01** | Error | Undefined reference: a \\| pipe |";
    expect((await joinDoc(doc({ rows: [ROWS.E05, ROWS.M001, ROWS.Y002, escaped] }))).findings).toEqual([]);
    // `Error \\|` is a literal backslash then a DELIMITER: three cells, with
    // the backslash left in the severity cell. Reading it as an escape merged
    // two cells and reported "found 2" instead.
    const doubled = String.raw`| **E01** | Error \\| Undefined reference: tail |`;
    const { findings } = await joinDoc(doc({ rows: [ROWS.E05, ROWS.M001, ROWS.Y002, doubled] }));
    expect(findings.some((f) => f.includes("found 2"))).toBe(false);
    expect(findings.some((f) => f.includes(String.raw`E01 severity is "Error \\"`))).toBe(true);
  });
});

describe("lint-table doc join — live", () => {
  it("website/guide/lint.md agrees with the code (RULE_META through tsx, renderer from the keybinding module)", async () => {
    const { findings, info } = await run({ root: REPO_ROOT });
    expect(findings).toEqual([]);
    expect(info.join("\n")).toContain("17 documented rules");
    expect(info.join("\n")).toContain("validateMarkdown → Alt + Mod + V");
  });
});
