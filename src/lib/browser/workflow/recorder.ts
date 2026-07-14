/**
 * Workflow recorder — action trace → workflow file (WI-4.3 / R10).
 *
 * ⚠️ **NOT WIRED — no production caller.** Also: secret redaction here trusts the
 * page-world `sensitive` flag, so a hostile page could mark a password field
 * `sensitive: false` and have it serialized. Redaction must move to trusted browser
 * code before this is wired. (Branch audit.)
 *
 * Purpose: convert a recorded trace of user actions (navigate / click / type /
 * extract, located by ARIA role + accessible name) into the workflow text the
 * parser reads, so a human can record a task once and replay/edit it. This is
 * the pure conversion half; the page-world capture that produces the trace is
 * the injected recorder (R10 — page-world, tamperable, an accepted bounded
 * trade, never a security boundary).
 *
 * R10 honesty rule enforced here: a value marked `sensitive` (a password/token/
 * CSRF field) is NEVER written into the workflow — it is redacted, on EVERY event
 * type (a URL can carry a token just as a text field can).
 *
 * The workflow file is line-oriented, so a recorded value is page-controlled data in
 * a text format: an unescaped newline in an accessible name would FORGE A STEP the
 * user never performed. Every recorded value is therefore emitted through `quote`
 * (JSON string escaping — reversible, and it cannot break out of its line), and the
 * front-matter scalars are validated rather than escaped, so a bad `site` fails loudly
 * instead of producing a corrupt file. The output is a document the parser accepts —
 * except for an EMPTY trace, which yields front-matter with no steps and is reported
 * by the parser as `no-steps` (an empty recording is not a runnable workflow).
 *
 * @coordinates-with lib/browser/workflow/parser.ts — output is parseable source; input
 *   names are validated with the parser's own rule
 * @coordinates-with lib/browser/agent/aria.ts — events are located by role+name
 * @module lib/browser/workflow/recorder
 */
import { isValidInputName } from "./parser";

/** One recorded user action. */
export interface RecordedEvent {
  type: "navigate" | "click" | "type" | "extract";
  /** Target URL, for `navigate`. */
  url?: string;
  /** ARIA role of the target, for click/type. */
  role?: string;
  /** Accessible name of the target (click/type) or extract description. */
  name?: string;
  /** Typed text (type) or extract detail. */
  text?: string;
  /** When true the value is a secret and is redacted, never captured (R10). */
  sensitive?: boolean;
}

const REDACTED = "‹redacted›";

/** Encode a recorded value as a quoted scalar. JSON escaping is reversible (the old
 *  `"` → `'` rewrite silently changed the value, so replay could target another
 *  control) and, crucially, escapes line breaks — page content cannot forge a step. */
function quote(value: string): string {
  return JSON.stringify(value);
}

/** The DATA a step carries (typed text, target URL, extracted detail) — redacted when
 *  the event is marked sensitive (R10). A locator is not data: the field's label
 *  ("Password") stays, so the step is still replayable; only the secret goes. */
function visible(ev: RecordedEvent, raw: string | undefined): string {
  return ev.sensitive ? REDACTED : raw ?? "";
}

/** A recorded role is page-world data (R10), yet it is appended unquoted as `(role)`.
 *  Only a clean ARIA-token role is kept; anything else (a newline, `)`, or `"` that
 *  would break the line and forge a step, just like an unescaped name would) drops the
 *  role, so the locator degrades to name-only rather than corrupting the file. */
function safeRole(role: string | undefined): string {
  return role && /^[a-zA-Z-]+$/.test(role) ? role : "";
}

/** `"name" (role)` — one target format for click AND type: an accessible name alone
 *  is ambiguous when two controls share it, so the role is part of the locator. */
function target(ev: RecordedEvent): string {
  const role = safeRole(ev.role);
  return `${quote(ev.name ?? "")}${role ? ` (${role})` : ""}`;
}

/** The first value that carries something after trimming (whitespace-only text is not
 *  a description — and an all-blank `extract:` line is not even parseable). */
function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((v) => v !== undefined && v.trim() !== "");
}

function stepLine(ev: RecordedEvent): string {
  switch (ev.type) {
    case "navigate": {
      // Normalize FIRST: a whitespace-only URL folds to empty, which must degrade to a
      // bare "navigate" rather than a dangling "navigate to " the parser trips over.
      // The URL is data — a callback URL can carry a token (R10).
      const url = fold(visible(ev, ev.url ?? ""));
      return url ? `action: navigate to ${url}` : "action: navigate";
    }
    case "click":
      // A click has no data — only a target. Its accessible name is the locator.
      return `action: click ${target(ev)}`;
    case "type":
      return `action: type ${quote(visible(ev, ev.text))} into ${target(ev)}`;
    case "extract": {
      // An extract instruction is prose, so it stays unquoted (a hand-written
      // `extract: new comments` must round-trip byte-for-byte). It still reaches the
      // end of the line, so line breaks — which would forge a step — are folded out.
      // Redaction goes through the single `visible` helper so the security-critical
      // rule cannot drift from the one every other event type uses.
      const detail = visible(ev, firstNonBlank(ev.text, ev.name) ?? "content");
      return `extract: ${fold(detail)}`;
    }
  }
}

/** Fold line breaks out of an unquoted field: page content must not start a new line
 *  (and therefore a new step) in a line-oriented file. */
function fold(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** A front-matter value is written verbatim to the end of its line: a blank or
 *  multi-line scalar would drop the field or terminate the block. Fail loudly. */
function requireScalar(field: string, value: string): string {
  if (value.trim() === "" || /[\r\n]/.test(value)) {
    throw new TypeError(`traceToWorkflow: "${field}" must be a non-empty single-line value.`);
  }
  return value.trim();
}

/** Serialize `inputs: [a, b]` under the parser's OWN name rule — an invalid or
 *  duplicated name would otherwise produce a file the parser rejects (or, worse, a
 *  comma/bracket in a name would silently change the declared inputs). */
function serializeInputs(inputs: readonly string[]): string {
  const seen = new Set<string>();
  for (const name of inputs) {
    if (!isValidInputName(name)) {
      throw new TypeError(`traceToWorkflow: invalid input name "${name}".`);
    }
    if (seen.has(name)) throw new TypeError(`traceToWorkflow: duplicate input name "${name}".`);
    seen.add(name);
  }
  return `inputs: [${inputs.join(", ")}]`;
}

/** Convert a recorded trace into workflow source text (parser-compatible).
 *  Throws `TypeError` on options that cannot be serialized (see `requireScalar`). */
export function traceToWorkflow(
  trace: readonly RecordedEvent[],
  opts: { site: string; inputs?: string[]; trigger?: string },
): string {
  const frontMatter = ["---", `site: ${requireScalar("site", opts.site)}`];
  if (opts.inputs && opts.inputs.length > 0) {
    frontMatter.push(serializeInputs(opts.inputs));
  }
  if (opts.trigger) frontMatter.push(`trigger: ${requireScalar("trigger", opts.trigger)}`);
  frontMatter.push("---");

  const steps = trace.map((ev, i) => `${i + 1}. ${stepLine(ev)}`);
  return `${[...frontMatter, ...steps].join("\n")}\n`;
}
