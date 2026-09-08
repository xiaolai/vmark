#!/usr/bin/env node
/**
 * MCP docs-drift gate (WI-NB9.1) — every action the sidecar tools ship must be
 * documented on the public MCP reference page.
 *
 * The website page `website/guide/mcp-tools.md` is hand-written. A new tool
 * action can ship in the sidecar and never reach the docs — which is how
 * `mcp-tools.md` came to contradict the code (it said cookie capture was a
 * follow-up after it had shipped). This gate reads the ACTION ENUMS out of the
 * sidecar tool sources and fails if any action is not documented as a code span
 * on the reference page.
 *
 * What "documented" means here is an AFFIRMATIVE ENTRY in the right place, read
 * from the page's own structure: inside the `## \`<tool>\`` section of the tool
 * that ships the action, a `###`/`####` heading naming the action, or a list
 * item / table row that LEADS with its code span (`- \`claims\` — …`) — and
 * whose text does not WITHDRAW it (`- \`claims\` — no longer supported` is a
 * removal notice, not documentation; `NEGATED` is the vocabulary). A code
 * span anywhere on the page used to count, so a cross-reference from another
 * tool's section, an example, or a "no longer supported" note validated an
 * action that had no entry of its own (audit 20260907 #50). Descriptions are
 * still prose and drift legitimately; the entry is what must exist. Measured
 * 41/41 on adoption, so it ships zero-tolerance with no allowlist.
 *
 * Self-tested by `scripts/check-mcp-docs.test.mjs`.
 *
 * @coordinates-with server/mcp/src/tools/*.ts — the action enums
 * @coordinates-with website/guide/mcp-tools.md — the reference page
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_DIR = join(ROOT, "server/mcp/src/tools");
const DOC = join(ROOT, "website/guide/mcp-tools.md");

/** Every `action: z.enum([...])` / `action: z.enum(CONST)` site in a tool source. */
const ACTION_SITE = /action:\s*z\s*\n?\s*\.enum\(\s*(\[([\s\S]*?)\]|([A-Za-z_$][\w$]*))\s*\)/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `source` with comments and string CONTENTS blanked to spaces, lengths kept,
 * so `action:` and braces can be located in CODE: a schema in a comment is
 * not declared, and a brace inside a `.describe('…')` does not close a body.
 */
function codeOnly(source) {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (m) => (m[0] === "/" ? " ".repeat(m.length) : `${m[0]}${" ".repeat(m.length - 2)}${m[0]}`),
  );
}

/** `[start, end)` of every `inputSchema: { … }` body, brace-matched over code. */
function inputSchemaBodies(code) {
  const out = [];
  for (const m of code.matchAll(/\binputSchema\s*:\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") depth -= 1;
    }
    out.push([m.index, i]);
  }
  return out;
}

/**
 * How many `action` schemas the source DECLARES: every `action: <expr>`
 * property inside an `inputSchema: { … }` body, whatever the expression —
 * `action: ACTION_SCHEMA` names a schema built elsewhere and used to be
 * invisible, since only `action: z…` was counted (audit 20260907 #47) — plus
 * any `action: z…` outside one. Read over code, so a commented-out schema
 * declares nothing.
 */
export function declaredActionSchemas(source) {
  const code = codeOnly(source);
  const bodies = inputSchemaBodies(code);
  let declared = 0;
  for (const m of code.matchAll(/\baction\s*:\s*([A-Za-z_$][\w$]*)/g)) {
    if (m[1] === "z" || bodies.some(([start, end]) => m.index > start && m.index < end)) declared += 1;
  }
  return declared;
}

/**
 * Every string literal in an enum body, comments stripped — NO naming filter,
 * and NO other element shape tolerated.
 *
 * A spread (`z.enum([...BROWSER_ACTIONS, 'wait'])`), an identifier or a call
 * used to be ignored as long as ONE literal was present, so every action the
 * spread contributed shipped without a docs check — the third form the header
 * promises cannot hide (audit R2 #73). The residue after the literals are
 * removed must be separators only, or the gate fails closed.
 */
function stringLiterals(body, where) {
  const code = body.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length)).replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  const matches = [...code.matchAll(/(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)];
  const marks = code.split("");
  for (const m of matches) for (let i = m.index; i < m.index + m[0].length; i++) marks[i] = " ";
  const residue = marks.join("").replace(/[\s,]+/g, "");
  if (residue !== "") {
    throw new Error(
      `extractActions: an \`action\` enum${where ? ` (${where})` : ""} holds element text this gate cannot read: ` +
        `${JSON.stringify(residue.slice(0, 120))} — a spread or a computed element would ship actions unchecked`,
    );
  }
  return matches.map((m) => m[2]);
}

/**
 * Extract the string literals of EVERY `action` enum in a tool source.
 *
 * Two declaration forms ship: an inline literal array (`z.enum(['a', 'b'])`)
 * and a const array named at the enum site (`z.enum(COHERENCE_ACTIONS)` with
 * `const COHERENCE_ACTIONS = ['a', 'b'] as const;` above it, or — the browser
 * halves — imported from a sibling module: `import { BROWSER_ACTIONS } from
 * './browserActions.js'`, followed through `readSibling`). The named form used
 * to be invisible: the gate reported 37 actions against 41 shipped, and the
 * four it never read stayed unchecked. A named array that cannot be found in
 * the file or the sibling it imports it from is an ERROR, not an empty list,
 * so a third form cannot hide.
 *
 * Three more ways an action could hide, each now an error or read verbatim:
 *   - only the FIRST enum in a file was read, so a second schema in the same
 *     file was unchecked — every site is read now;
 *   - an `action: z…` declared in a shape this regex does not match returned
 *     [] for that file, and the "found no actions" guard only fires when EVERY
 *     file is blank — now EVERY `action: z…` declaration must be one this gate
 *     read: a file with one readable enum and one unreadable schema beside it
 *     throws too, instead of passing on the half it understood;
 *   - literals were filtered to `[a-z_]+`, so `wait_for2`, `Read` or `a-b`
 *     were dropped before the docs check — every literal is taken as is.
 */
/**
 * The literal body of `const NAME = [ … ]` in `source`, or null.
 *
 * The DECLARATION is located in CODE (`codeOnly`, which preserves offsets), so
 * a commented-out or string-quoted declaration cannot shadow the real one —
 * and the closing bracket is found in code too, so a `]` inside a string
 * cannot end the array early (audit R2 #75). The BODY is then sliced from the
 * raw source, because the literals are what this reads.
 */
const declaredArray = (source, name) => {
  const code = codeOnly(source);
  const m = new RegExp(`const\\s+${escapeRe(name)}\\s*(?::[^=]+)?=\\s*\\[`).exec(code);
  if (!m) return null;
  const open = m.index + m[0].length;
  const close = code.indexOf("]", open);
  return close === -1 ? null : source.slice(open, close);
};

export function extractActions(source, readSibling = () => null) {
  const code = codeOnly(source);
  // A site inside a comment is not a schema: it would otherwise stand in for a
  // declared one the gate cannot read.
  const sites = [...source.matchAll(ACTION_SITE)].filter((m) => code.startsWith("action", m.index));
  const declared = declaredActionSchemas(source);
  if (declared > sites.length) {
    throw new Error(
      `extractActions: ${declared} \`action\` schema(s) declared but only ${sites.length} readable as ` +
        "`z.enum([...])` / `z.enum(CONST)` — the rest would ship unchecked",
    );
  }
  if (sites.length === 0) return [];
  const actions = [];
  for (const site of sites) {
    let body = site[2];
    if (body === undefined) {
      const name = site[3];
      let decl = declaredArray(source, name);
      if (decl === null) {
        const imported = new RegExp(`import\\s*\\{[^}]*\\b${escapeRe(name)}\\b[^}]*\\}\\s*from\\s*['"]\\./([\\w.-]+?)(?:\\.js)?['"]`).exec(source);
        const sibling = imported ? readSibling(imported[1]) : null;
        decl = sibling === null ? null : declaredArray(sibling, name);
      }
      if (decl === null) throw new Error(`extractActions: \`action: z.enum(${name})\` names an array neither this file nor a sibling it imports declares`);
      body = decl;
    }
    const literals = stringLiterals(body, site[3] ?? "inline");
    if (literals.length === 0) throw new Error("extractActions: an `action` enum declares no string literal");
    actions.push(...literals);
  }
  return [...new Set(actions)];
}

/**
 * The tool name a source registers: `registerTool({ name: 'session', …})`, as a
 * literal or as a same-file string const (`name: SESSION_TOOL`). `null` when
 * the file registers no tool; a name behind an identifier this file does not
 * declare is an error — the docs gate cannot place its actions.
 */
export function toolName(source) {
  // Located in CODE, so a `registerTool({ name: 'x'` inside a comment or a
  // description string is not a registration; and a file with TWO of them is
  // refused rather than silently attributing every action to the first
  // (audit R2 #77). `codeOnly` preserves offsets, so the literal is read back
  // out of the raw source at the position code says it starts.
  const code = codeOnly(source);
  const sites = [...code.matchAll(/registerTool\(\s*\{\s*name:\s*/g)];
  if (sites.length === 0) return null;
  if (sites.length > 1) {
    throw new Error(`toolName: ${sites.length} registerTool({ name: … }) sites in one file — the docs gate cannot place its actions`);
  }
  const at = sites[0].index + sites[0][0].length;
  const m = /^(?:'([a-z_]+)'|"([a-z_]+)"|([A-Za-z_$][\w$]*))/.exec(source.slice(at));
  if (!m) throw new Error("toolName: registerTool's `name` is neither a string literal nor an identifier");
  if (m[1] ?? m[2]) return m[1] ?? m[2];
  const declAt = new RegExp(`const\\s+${escapeRe(m[3])}\\s*=\\s*`).exec(code);
  const decl = declAt ? /^['"]([a-z_]+)['"]/.exec(source.slice(declAt.index + declAt[0].length)) : null;
  if (!decl) throw new Error(`toolName: registerTool names its tool through \`${m[3]}\`, which this file does not declare as a string const`);
  return decl[1];
}

/** Every (tool file, tool name, action) triple the sidecar ships. */
export function shippedActions(toolsDir = TOOLS_DIR) {
  const out = [];
  const readSibling = (module) => {
    const sibling = join(toolsDir, `${module}.ts`);
    return existsSync(sibling) ? readFileSync(sibling, "utf8") : null;
  };
  for (const file of readdirSync(toolsDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(toolsDir, file), "utf8");
    const actions = extractActions(source, readSibling);
    if (actions.length === 0) continue;
    const tool = toolName(source);
    if (tool === null) throw new Error(`${file}: declares actions but registers no tool — the docs gate cannot place them`);
    for (const action of actions) out.push({ file, tool, action });
  }
  return out;
}

/**
 * The reference page's `## \`<tool>\`` sections: tool name → the section's
 * lines. A tool documented under TWO headings contributes both: `set` on a
 * repeat replaced the earlier section's lines, so an action documented there
 * was reported as missing — a false failure with the entry sitting on the page
 * (audit R2 #78).
 */
export function toolSections(docText) {
  const sections = new Map();
  let current = null;
  for (const line of docText.split("\n")) {
    const m = /^## `([a-z_]+)`\s*$/.exec(line);
    if (m) {
      current = m[1];
      if (!sections.has(current)) sections.set(current, []);
    } else if (/^## /.test(line)) {
      current = null;
    } else if (current !== null) {
      sections.get(current).push(line);
    }
  }
  return sections;
}

/**
 * Entry text that WITHDRAWS the action instead of documenting it. An entry
 * led by the code span used to pass however it continued, so
 * `- \`claims\` — no longer supported` documented `claims` (audit 20260907
 * #50). Vocabulary, not sentiment: a word here on the entry line makes it a
 * removal notice, and the action still needs an entry of its own.
 */
const NEGATED =
  /\b(?:no longer|not (?:yet )?(?:supported|available|implemented|shipped)|unsupported|deprecated|removed|retired|dropped|withdrawn|discontinued|obsolete)\b/i;

/** An affirmative entry: a heading naming the action, or a list item / table row led by its code span, and not withdrawn on the same line. */
function isEntryFor(line, action) {
  const span = `\`${action}\``;
  const led =
    (/^#{3,4} /.test(line) && line.includes(span)) || line.startsWith(`- ${span}`) || line.startsWith(`* ${span}`) || line.startsWith(`| ${span} |`);
  return led && !NEGATED.test(line);
}

/** Actions with no affirmative entry inside their own tool's section of the reference page. */
export function undocumented(actions, docText) {
  const sections = toolSections(docText);
  return actions.filter(({ tool, action }) => !(sections.get(tool) ?? []).some((line) => isEntryFor(line, action)));
}

function main() {
  const actions = shippedActions();
  if (actions.length === 0) {
    console.error("❌ check-mcp-docs: found no tool actions — the extractor is broken.");
    process.exit(1);
  }
  const docText = readFileSync(DOC, "utf8");
  const missing = undocumented(actions, docText);
  if (missing.length > 0) {
    console.error("❌ MCP actions shipped without an entry in their tool's section of website/guide/mcp-tools.md:");
    for (const { file, tool, action } of missing) console.error(`  ${tool}.${action}  (${file})`);
    console.error("\nDocument each under its tool's `## `tool`` section: a `### `action`` heading, or a list item / table row led by its code span (a line that withdraws the action — deprecated, removed, no longer supported — is not an entry).");
    process.exit(1);
  }
  console.error(`✅ MCP docs gate: all ${actions.length} sidecar tool actions are documented.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
