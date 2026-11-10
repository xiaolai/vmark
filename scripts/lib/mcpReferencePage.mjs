/**
 * Purpose: join the public MCP reference page to the actions the sidecar ships
 * — the website half of the MCP docs gate.
 *
 * An action is documented when its own tool's `## \`<tool>\`` section holds an
 * affirmative entry for it; the CLI's header states the rule in full.
 *
 * @coordinates-with scripts/check-mcp-docs.mjs — the CLI; supplies the shipped actions
 * @coordinates-with website/guide/mcp-tools.md — the page this reads
 * @coordinates-with scripts/check-mcp-docs.test.mjs — the self-test
 * @module scripts/lib/mcpReferencePage
 */
import { NEGATED } from "./mcpReadmeJoin.mjs";

/**
 * The reference page's `## \`<tool>\`` sections: tool name → the section's
 * lines. A tool documented under TWO headings contributes both: `set` on a
 * repeat replaced the earlier section's lines, so an action documented there
 * was reported as missing — a false failure with the entry sitting on the page.
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
 * An affirmative entry: a heading naming the action, or a list item / table
 * row led by its code span, and not withdrawn on the same line. An entry led
 * by the code span used to pass however it continued, so
 * `- \`claims\` — no longer supported` documented `claims`; `NEGATED` is the vocabulary that makes a line a removal notice.
 */
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
