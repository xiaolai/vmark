/**
 * Purpose: the guide claims joined by guideClaims.mjs — each one a sentence
 *   or table on a guide page and the code that makes it true (WI-RA15C.10).
 *
 * Add a claim when a guide page states something a pattern can read on both
 * sides: a number, a name, a list. Prose that needs judgment stays out.
 * The code side is read through `codeOf(t, key)` (codeView.mjs): a declaration
 * commented out or quoted inside a string never stands in for the real one.
 *
 * @coordinates-with scripts/lib/docJoins/guideClaims.mjs — the runner
 * @module scripts/lib/docJoins/guideClaimsTable
 */
import { codeView } from "./codeView.mjs";
import { stripMarkdown } from "./markdownTables.mjs";
import {
  arrayStrings, capture, captureCode, codeIndexOf, delimitedBody, displayChord, durationMs, equal, numberFromWord,
  rustFnBodies, rustReachableFns, setDiff, spansAfter, tableUnder,
} from "./guideClaimsHelpers.mjs";

export { arrayStrings, capture, durationMs, numberFromWord, spansAfter };

/** Every file a claim reads, by key. */
export const CLAIM_PATHS = {
  browserGuide: "website/guide/browser.md",
  browserCommands: "src/services/commands/browserCommands.ts",
  omnibox: "src/lib/browser/omnibox.ts",
  mcpSetupGuide: "website/guide/mcp-setup.md",
  tokenField: "src-tauri/src/mcp_config/client_token_field.rs",
  sessionLabel: "server/mcp/src/utils/sessionLabel.ts",
  featuresGuide: "website/guide/features.md",
  imeGuard: "src/utils/imeGuard.ts",
  formatsGuide: "website/guide/formats.md",
  largeFilesGuide: "website/guide/large-files.md",
  fileSizeThresholds: "src/utils/fileSizeThresholds.ts",
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
  gitExportGuide: "website/guide/edit-history-git.md",
  gitExportNames: "src-tauri/src/agent_journal/git_export/names.rs",
  gitExportPlan: "src-tauri/src/agent_journal/git_export/plan.rs",
};

/** The source file `key` of the texts `t`, as code (comments blanked, literals located). */
const codeOf = (t, key) => codeView(t[key], CLAIM_PATHS[key]);

/**
 * The plan.rs functions that build a commit's trailer list, and the entry
 * that constructs the commits: a builder counts only while that entry still
 * reaches it, so a builder left defined but no longer called is not emitted.
 */
const GIT_TRAILER_BUILDERS = ["common_trailers", "agent_trailers", "synthetic_commit"];
const GIT_COMMIT_ENTRY = "plan";

export const CLAIMS = [
  {
    name: "browser start page",
    files: ["browserGuide", "browserCommands"],
    check: (t) => equal(
      capture(t.browserGuide, /A new browser tab opens on \w+ \(`([^`]+)`\)/, "browser.md start-page sentence"),
      captureCode(codeOf(t, "browserCommands"), /NEW_BROWSER_TAB_URL\s*=\s*"([^"]+)"/, "NEW_BROWSER_TAB_URL"),
      "start page"),
  },
  {
    name: "browser search engine",
    files: ["browserGuide", "omnibox"],
    check: (t) => {
      const named = capture(t.browserGuide, /the omnibox searches with (\w+)/, "browser.md search sentence").toLowerCase();
      const host = new URL(captureCode(codeOf(t, "omnibox"), /SEARCH_URL_BASE\s*=\s*"([^"]+)"/, "SEARCH_URL_BASE")).hostname;
      return host === `${named}.com` ? [] : [`the guide names ${named}, SEARCH_URL_BASE searches ${host}`];
    },
  },
  {
    name: "MCP client credential key",
    files: ["mcpSetupGuide", "tokenField"],
    check: (t) => {
      const key = captureCode(codeOf(t, "tokenField"), /TOKEN_ENV_KEY: &str = "([^"]+)"/, "TOKEN_ENV_KEY");
      return [`env.${key}`, `environment.${key}`]
        .filter((span) => !t.mcpSetupGuide.includes(`\`${span}\``))
        .map((span) => `mcp-setup.md does not name \`${span}\``);
    },
  },
  {
    name: "MCP session label",
    files: ["mcpSetupGuide", "sessionLabel"],
    check: (t) => {
      const env = captureCode(codeOf(t, "sessionLabel"), /SESSION_LABEL_ENV = '([^']+)'/, "SESSION_LABEL_ENV");
      const named = t.mcpSetupGuide.includes(`\`${env}\``) ? [] : [`mcp-setup.md does not name \`${env}\``];
      return [
        ...named,
        ...equal(
          capture(t.mcpSetupGuide, /The label is at most (\d+) UTF-8 bytes/, "mcp-setup.md session label sentence"),
          captureCode(codeOf(t, "sessionLabel"), /MAX_SESSION_LABEL_BYTES = (\d+)/, "MAX_SESSION_LABEL_BYTES"),
          "label bytes"),
      ];
    },
  },
  {
    name: "IME grace period",
    files: ["featuresGuide", "imeGuard"],
    check: (t) => equal(
      capture(t.featuresGuide, /for (\d+) ms after the composition ends/, "features.md IME sentence"),
      captureCode(codeOf(t, "imeGuard"), /IME_GRACE_PERIOD_MS = (\d+)/, "IME_GRACE_PERIOD_MS"),
      "grace period (ms)"),
  },
  {
    name: "nesting limit",
    files: ["formatsGuide", "largeFilesGuide", "nestingDepth"],
    check: (t) => {
      const code = captureCode(codeOf(t, "nestingDepth"), /MAX_NESTING_DEPTH = (\d+)/, "MAX_NESTING_DEPTH");
      return [
        ...equal(capture(t.formatsGuide, /nested up to (\d+) levels deep/, "formats.md nesting sentence"), code, "formats.md limit"),
        ...equal(capture(t.largeFilesGuide, /nested more than (\d+) levels deep/, "large-files.md nesting sentence"), code, "large-files.md limit"),
      ];
    },
  },
  {
    name: "block-density threshold",
    files: ["largeFilesGuide", "fileSizeThresholds"],
    check: (t) => equal(
      capture(t.largeFilesGuide, /fewer than ([\d,]+) estimated blocks/, "large-files.md block threshold").replace(/,/g, ""),
      captureCode(codeOf(t, "fileSizeThresholds"), /SOURCE_MODE_DEFAULT_BLOCKS:\s*([\d_]+)/, "SOURCE_MODE_DEFAULT_BLOCKS").replace(/_/g, ""),
      "block-density threshold (blocks)"),
  },
  {
    name: "menu readiness budget",
    files: ["largeFilesGuide", "windowReady"],
    check: (t) => {
      // The guide quotes the log line, so the line's wording is a claim too.
      const view = codeOf(t, "windowReady");
      captureCode(view, /(menu commands did not mount within \$\{MENU_COMMANDS_BUDGET_MS\}ms)/, "useWindowReady.ts readiness log line", { inLiteral: true });
      return equal(
        capture(t.largeFilesGuide, /\*menu commands did not mount within (\d+)ms\*/, "large-files.md readiness log line"),
        Number(captureCode(view, /MENU_COMMANDS_BUDGET_MS = ([\d_]+)/, "MENU_COMMANDS_BUDGET_MS").replace(/_/g, "")),
        "menu readiness budget (ms)",
      );
    },
  },
  {
    name: "prompt history size",
    files: ["aiGeniesGuide", "promptHistory"],
    check: (t) => equal(
      capture(t.aiGeniesGuide, /\(up to (\d+) prompts\)/, "ai-genies.md history size"),
      captureCode(codeOf(t, "promptHistory"), /const MAX_ENTRIES = (\d+)/, "MAX_ENTRIES"),
      "history size"),
  },
  {
    name: "terminal hangup grace",
    files: ["terminalGuide", "ptyChild"],
    check: (t) => equal(
      durationMs(capture(t.terminalGuide, /waits up to (a second|\w+ seconds?|\d+ ms) for it to exit/, "terminal.md hangup sentence")),
      Number(captureCode(codeOf(t, "ptyChild"), /HANGUP_GRACE: Duration = Duration::from_millis\((\d+)\)/, "HANGUP_GRACE")),
      "hangup grace (ms)"),
  },
  {
    name: "confirm-quit window",
    files: ["tabNavigationGuide", "quit"],
    check: (t) => equal(
      numberFromWord(capture(t.tabNavigationGuide, /press it again within (\w+) seconds/, "tab-navigation.md confirm-quit sentence")),
      Number(captureCode(codeOf(t, "quit"), /CONFIRM_QUIT_WINDOW: Duration = Duration::from_secs\((\d+)\)/, "CONFIRM_QUIT_WINDOW")),
      "confirm-quit window (s)"),
  },
  {
    name: "workspace.close refusal reasons",
    files: ["mcpToolsGuide", "workspaceBridge"],
    check: (t) => {
      const view = codeOf(t, "workspaceBridge");
      const start = codeIndexOf(view, "export async function handleWorkspaceClose", "handleWorkspaceClose");
      const body = delimitedBody(view, start, "{", "handleWorkspaceClose");
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
      const [defs, actions] = [codeOf(t, "shortcutDefinitions"), codeOf(t, "textActions")];
      for (const actionId of ["sortLinesAsc", "sortLinesDesc"]) {
        const key = captureCode(defs, new RegExp(`id: "${actionId}"[^}]*defaultKey: "([^"]+)"`), `${actionId} default key`);
        const wysiwyg = captureCode(actions, new RegExp(`${actionId}: \\{[^}]*?supports: \\{ wysiwyg: (true|false)`), `${actionId} supports`);
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
      const view = codeOf(t, "programNames");
      const known = arrayStrings(view, "KNOWN_EDITORS");
      const runs = arrayStrings(view, "RUNS_ITS_ARGUMENT");
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
      const view = codeOf(t, "sidecarIndex");
      const start = codeIndexOf(view, "export const TOOL_REGISTRY = [", "TOOL_REGISTRY");
      const body = delimitedBody(view, start, "[", "TOOL_REGISTRY");
      const count = [...body.matchAll(/^\s{4}name: \w+,$/gm)].length;
      return equal(
        numberFromWord(capture(t.mcpToolsGuide, /exposes \*\*(\w+) composite MCP tools\*\*/, "mcp-tools.md tool count")),
        count,
        "tool count");
    },
  },
  {
    name: "Git export branch",
    files: ["gitExportGuide", "gitExportNames"],
    check: (t) => equal(
      capture(t.gitExportGuide, /goes to its own branch, `([^`<]+)<document-uuid>`/, "edit-history-git.md branch sentence"),
      captureCode(codeOf(t, "gitExportNames"), /format!\("([^"{]+)\{doc\}"\)/, "branch name format"),
      "branch prefix"),
  },
  {
    name: "Git export trailers",
    files: ["gitExportGuide", "gitExportPlan"],
    check: (t) => {
      const doc = tableUnder(t.gitExportGuide, "What the branch holds", "Trailer")
        .flatMap((cells) => [...cells[0].matchAll(/`(VMark-[A-Za-z]+)`/g)].map((m) => m[1]));
      // Only what the trailer builders emit: a tuple of the same shape elsewhere is not a trailer.
      const reached = rustReachableFns(t.gitExportPlan, GIT_COMMIT_ENTRY);
      const live = GIT_TRAILER_BUILDERS.filter((name) => reached.has(name));
      const dead = GIT_TRAILER_BUILDERS.filter((name) => !reached.has(name))
        .map((name) => `plan.rs: ${name} is not reachable from ${GIT_COMMIT_ENTRY}(), so its trailers are not emitted`);
      const builders = live.length > 0 ? rustFnBodies(t.gitExportPlan, live) : "";
      const code = [...new Set([...builders.matchAll(/\("(VMark-[A-Za-z]+)",/g)].map((m) => m[1]))];
      return [...dead, ...setDiff(doc.sort(), code.sort(), "edit-history-git.md trailer table", "plan.rs")];
    },
  },
];
