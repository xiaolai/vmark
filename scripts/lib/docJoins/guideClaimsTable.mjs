/**
 * Purpose: the guide claims joined by guideClaims.mjs — each one a sentence
 *   or table on a guide page and the code that makes it true (WI-RA15C.10).
 *
 * Add a claim when a guide page states something a pattern can read on both
 * sides: a number, a name, a list. Prose that needs judgment stays out.
 *
 * @coordinates-with scripts/lib/docJoins/guideClaims.mjs — the runner
 * @module scripts/lib/docJoins/guideClaimsTable
 */
import { parseTables, stripMarkdown } from "./markdownTables.mjs";

/** Every file a claim reads, by key. */
export const CLAIM_PATHS = {
  browserGuide: "website/guide/browser.md",
  browserCommands: "src/services/commands/browserCommands.ts",
  omnibox: "src/lib/browser/omnibox.ts",
  mcpSetupGuide: "website/guide/mcp-setup.md",
  tokenField: "src-tauri/src/mcp_config/client_token_field.rs",
  featuresGuide: "website/guide/features.md",
  imeGuard: "src/utils/imeGuard.ts",
  formatsGuide: "website/guide/formats.md",
  largeFilesGuide: "website/guide/large-files.md",
  nestingDepth: "src/utils/markdownPipeline/nestingDepth.ts",
  windowReady: "src/contexts/useWindowReady.ts",
  tauriConf: "src-tauri/tauri.conf.json",
  settingsGuide: "website/guide/settings.md",
  programNames: "src-tauri/src/external_editor/program_names.rs",
  aiGeniesGuide: "website/guide/ai-genies.md",
  promptHistory: "src/stores/aiStore/promptHistory.ts",
  terminalGuide: "website/guide/terminal.md",
  ptyChild: "src-tauri/src/pty/child.rs",
  tabNavigationGuide: "website/guide/tab-navigation.md",
  quit: "src-tauri/src/quit.rs",
  mcpToolsGuide: "website/guide/mcp-tools.md",
  workspaceBridge: "src/services/mcpBridge/v2/workspace.ts",
  sidecarIndex: "server/mcp/src/index.ts",
  shortcutsGuide: "website/guide/shortcuts.md",
  shortcutDefinitions: "src/stores/settingsStore/shortcutDefinitions.ts",
  textActions: "src/plugins/actions/actionDefinitionsText.ts",
};

/** The first capture of `re` in `text`; throws, naming `what`, when it does not match. */
export function capture(text, re, what) {
  const m = re.exec(text);
  if (!m) throw new Error(`${what} not found (pattern ${re})`);
  return m[1];
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** "two" → 2, "12" → 12; throws on anything else. */
export function numberFromWord(word) {
  if (/^\d+$/.test(word)) return Number(word);
  const n = NUMBER_WORDS.indexOf(word.toLowerCase());
  if (n === -1) throw new Error(`"${word}" is not a number word this join knows`);
  return n;
}

/** "a second" / "2 seconds" / "500 ms" → milliseconds. */
export function durationMs(phrase) {
  if (phrase === "a second") return 1000;
  const m = /^(\w+) (seconds?|ms)$/.exec(phrase);
  if (!m) throw new Error(`"${phrase}" is not a duration this join reads`);
  return m[2] === "ms" ? numberFromWord(m[1]) : numberFromWord(m[1]) * 1000;
}

/** The string literals of the array literal a Rust or TS `const name` declares. */
export function arrayStrings(source, name) {
  const decl = new RegExp(`\\bconst\\s+${name}\\b[^=]*=`).exec(source);
  if (!decl) throw new Error(`no \`const ${name}\` declaration`);
  const open = source.indexOf("[", decl.index + decl[0].length);
  const close = source.indexOf("];", open);
  if (open === -1 || close === -1) throw new Error(`${name}: no array literal`);
  return [...source.slice(open, close).replace(/\/\/[^\n]*/g, "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

/** Code spans in the parenthesis that follows `lead` in `text`. */
export function spansAfter(text, lead, what) {
  const at = text.indexOf(lead);
  if (at === -1) throw new Error(`${what} not found ("${lead}")`);
  const close = text.indexOf(")", at + lead.length);
  return [...text.slice(at + lead.length, close).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** `a` and `b` as sorted lists, with what each lacks. */
function setDiff(a, b, aName, bName) {
  const out = [];
  for (const x of a) if (!b.includes(x)) out.push(`${aName} has \`${x}\`, ${bName} does not`);
  for (const x of b) if (!a.includes(x)) out.push(`${bName} has \`${x}\`, ${aName} does not`);
  return out;
}

const equal = (doc, code, what) => (String(doc) === String(code) ? [] : [`${what}: the guide says ${doc}, the code says ${code}`]);

/** `Shift-F4` → `Shift + F4`, the guide's display form. */
const displayChord = (key) => key.split("-").join(" + ");

/** The rows of the first table under `heading` whose first header cell reads `firstHeader`. */
function tableUnder(markdown, heading, firstHeader) {
  const table = parseTables(markdown).find((t) => t.heading === heading && stripMarkdown(t.headers[0] ?? "") === firstHeader);
  if (!table) throw new Error(`no "${firstHeader}" table under "${heading}"`);
  return table.rows.map((r) => r.cells);
}

export const CLAIMS = [
  {
    name: "browser start page",
    files: ["browserGuide", "browserCommands"],
    check: (t) => equal(
      capture(t.browserGuide, /A new browser tab opens on \w+ \(`([^`]+)`\)/, "browser.md start-page sentence"),
      capture(t.browserCommands, /NEW_BROWSER_TAB_URL\s*=\s*"([^"]+)"/, "NEW_BROWSER_TAB_URL"),
      "start page"),
  },
  {
    name: "browser search engine",
    files: ["browserGuide", "omnibox"],
    check: (t) => {
      const named = capture(t.browserGuide, /the omnibox searches with (\w+)/, "browser.md search sentence").toLowerCase();
      const host = new URL(capture(t.omnibox, /SEARCH_URL_BASE\s*=\s*"([^"]+)"/, "SEARCH_URL_BASE")).hostname;
      return host === `${named}.com` ? [] : [`the guide names ${named}, SEARCH_URL_BASE searches ${host}`];
    },
  },
  {
    name: "MCP client credential key",
    files: ["mcpSetupGuide", "tokenField"],
    check: (t) => {
      const key = capture(t.tokenField, /TOKEN_ENV_KEY: &str = "([^"]+)"/, "TOKEN_ENV_KEY");
      return [`env.${key}`, `environment.${key}`]
        .filter((span) => !t.mcpSetupGuide.includes(`\`${span}\``))
        .map((span) => `mcp-setup.md does not name \`${span}\``);
    },
  },
  {
    name: "IME grace period",
    files: ["featuresGuide", "imeGuard"],
    check: (t) => equal(
      capture(t.featuresGuide, /for (\d+) ms after the composition ends/, "features.md IME sentence"),
      capture(t.imeGuard, /IME_GRACE_PERIOD_MS = (\d+)/, "IME_GRACE_PERIOD_MS"),
      "grace period (ms)"),
  },
  {
    name: "nesting limit",
    files: ["formatsGuide", "largeFilesGuide", "nestingDepth"],
    check: (t) => {
      const code = capture(t.nestingDepth, /MAX_NESTING_DEPTH = (\d+)/, "MAX_NESTING_DEPTH");
      return [
        ...equal(capture(t.formatsGuide, /nested up to (\d+) levels deep/, "formats.md nesting sentence"), code, "formats.md limit"),
        ...equal(capture(t.largeFilesGuide, /nested more than (\d+) levels deep/, "large-files.md nesting sentence"), code, "large-files.md limit"),
      ];
    },
  },
  {
    name: "menu readiness budget",
    files: ["largeFilesGuide", "windowReady"],
    check: (t) => {
      // The guide quotes the log line, so the line's wording is a claim too.
      capture(t.windowReady, /(menu commands did not mount within \$\{MENU_COMMANDS_BUDGET_MS\}ms)/, "useWindowReady.ts readiness log line");
      return equal(
        capture(t.largeFilesGuide, /\*menu commands did not mount within (\d+)ms\*/, "large-files.md readiness log line"),
        Number(capture(t.windowReady, /MENU_COMMANDS_BUDGET_MS = ([\d_]+)/, "MENU_COMMANDS_BUDGET_MS").replace(/_/g, "")),
        "menu readiness budget (ms)",
      );
    },
  },
  {
    name: "prompt history size",
    files: ["aiGeniesGuide", "promptHistory"],
    check: (t) => equal(
      capture(t.aiGeniesGuide, /\(up to (\d+) prompts\)/, "ai-genies.md history size"),
      capture(t.promptHistory, /const MAX_ENTRIES = (\d+)/, "MAX_ENTRIES"),
      "history size"),
  },
  {
    name: "terminal hangup grace",
    files: ["terminalGuide", "ptyChild"],
    check: (t) => equal(
      durationMs(capture(t.terminalGuide, /waits up to (a second|\w+ seconds?|\d+ ms) for it to exit/, "terminal.md hangup sentence")),
      Number(capture(t.ptyChild, /HANGUP_GRACE: Duration = Duration::from_millis\((\d+)\)/, "HANGUP_GRACE")),
      "hangup grace (ms)"),
  },
  {
    name: "confirm-quit window",
    files: ["tabNavigationGuide", "quit"],
    check: (t) => equal(
      numberFromWord(capture(t.tabNavigationGuide, /press it again within (\w+) seconds/, "tab-navigation.md confirm-quit sentence")),
      Number(capture(t.quit, /CONFIRM_QUIT_WINDOW: Duration = Duration::from_secs\((\d+)\)/, "CONFIRM_QUIT_WINDOW")),
      "confirm-quit window (s)"),
  },
  {
    name: "workspace.close refusal reasons",
    files: ["mcpToolsGuide", "workspaceBridge"],
    check: (t) => {
      const start = t.workspaceBridge.indexOf("export async function handleWorkspaceClose");
      if (start === -1) throw new Error("handleWorkspaceClose not found");
      const body = t.workspaceBridge.slice(start, t.workspaceBridge.indexOf("\n}\n", start));
      const code = [...new Set([...body.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]))].sort();
      const doc = tableUnder(t.mcpToolsGuide, "close", "reason").map((cells) => stripMarkdown(cells[0])).sort();
      return setDiff(doc, code, "mcp-tools.md `close` table", "handleWorkspaceClose");
    },
  },
  {
    name: "sort lines are Source-only",
    files: ["shortcutsGuide", "shortcutDefinitions", "textActions"],
    check: (t) => {
      const rows = tableUnder(t.shortcutsGuide, "F-Key Quick Reference", "Key");
      const out = [];
      for (const actionId of ["sortLinesAsc", "sortLinesDesc"]) {
        const key = capture(t.shortcutDefinitions, new RegExp(`id: "${actionId}"[^}]*defaultKey: "([^"]+)"`), `${actionId} default key`);
        const wysiwyg = capture(t.textActions, new RegExp(`${actionId}: \\{[^}]*?supports: \\{ wysiwyg: (true|false)`), `${actionId} supports`);
        const row = rows.find((cells) => stripMarkdown(cells[0]) === displayChord(key));
        if (!row) { out.push(`no F-Key Quick Reference row for ${displayChord(key)} (${actionId})`); continue; }
        const saysSourceOnly = /Source mode only/.test(row[1]);
        if (saysSourceOnly !== (wysiwyg === "false")) {
          out.push(`${displayChord(key)} row ${saysSourceOnly ? "says" : "does not say"} Source mode only; ${actionId} supports WYSIWYG: ${wysiwyg}`);
        }
      }
      return out;
    },
  },
  {
    name: "OS file associations",
    files: ["formatsGuide", "tauriConf"],
    check: (t) => {
      const assoc = JSON.parse(t.tauriConf).bundle?.fileAssociations;
      if (!Array.isArray(assoc)) throw new Error("tauri.conf.json has no bundle.fileAssociations");
      const code = assoc.map((a) => `${a.ext.map((e) => `.${e}`).join(", ")} = ${a.description}`).sort();
      const doc = tableUnder(t.formatsGuide, "Opening files from your system", "Extensions")
        .map((cells) => `${stripMarkdown(cells[0])} = ${stripMarkdown(cells[1])}`).sort();
      return setDiff(doc, code, "formats.md association table", "tauri.conf.json");
    },
  },
  {
    name: "external-editor names",
    files: ["formatsGuide", "settingsGuide", "programNames"],
    check: (t) => {
      const known = arrayStrings(t.programNames, "KNOWN_EDITORS");
      const runs = arrayStrings(t.programNames, "RUNS_ITS_ARGUMENT");
      const out = [];
      const editors = [
        ...spansAfter(t.formatsGuide, "**name of a known editor** (", "formats.md known-editor list"),
        ...spansAfter(t.settingsGuide, "the name of a known editor (", "settings.md known-editor list"),
      ];
      for (const name of editors) if (!known.includes(name)) out.push(`\`${name}\` is named as a known editor but is not in KNOWN_EDITORS`);
      for (const lead of ["a shell (", "an interpreter (", "a launcher ("]) {
        for (const name of spansAfter(t.formatsGuide, lead, `formats.md refused-program list "${lead}"`)) {
          if (!runs.includes(name)) out.push(`\`${name}\` is named as refused but is not in RUNS_ITS_ARGUMENT`);
        }
      }
      return out;
    },
  },
  {
    name: "MCP tool count",
    files: ["mcpToolsGuide", "sidecarIndex"],
    check: (t) => {
      const start = t.sidecarIndex.indexOf("export const TOOL_REGISTRY = [");
      if (start === -1) throw new Error("TOOL_REGISTRY not found");
      const body = t.sidecarIndex.slice(start, t.sidecarIndex.indexOf("\n];", start));
      const count = [...body.matchAll(/^\s{4}name: \w+,$/gm)].length;
      return equal(
        numberFromWord(capture(t.mcpToolsGuide, /exposes \*\*(\w+) composite MCP tools\*\*/, "mcp-tools.md tool count")),
        count,
        "tool count");
    },
  },
];
