/**
 * Workflow recorder — action trace → workflow file (WI-4.3 / R10).
 *
 * Purpose: convert a recorded trace of user actions (navigate / click / type /
 * extract, located by ARIA role + accessible name) into the workflow text the
 * parser reads, so a human can record a task once and replay/edit it. This is
 * the pure conversion half; the page-world capture that produces the trace is
 * the injected recorder (R10 — page-world, tamperable, an accepted bounded
 * trade, never a security boundary).
 *
 * R10 honesty rule enforced here: a value marked `sensitive` (a password/token/
 * CSRF field) is NEVER written into the workflow — it is redacted. The output is
 * always a document the parser accepts (round-trip verified in tests).
 *
 * @coordinates-with lib/browser/workflow/parser.ts — output is parseable source
 * @coordinates-with lib/browser/agent/aria.ts — events are located by role+name
 * @module lib/browser/workflow/recorder
 */

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

const REDACTED = "‹redacted›"; // ‹redacted›

/** Quote a value for a step line without letting it break the quoting. */
function quote(value: string): string {
  return `"${value.replace(/"/g, "'")}"`;
}

function stepLine(ev: RecordedEvent): string {
  switch (ev.type) {
    case "navigate":
      // Every step needs non-empty text for the parser; a url-less navigate is
      // just "navigate" (degenerate but valid) rather than a dangling "to ".
      return ev.url ? `action: navigate to ${ev.url}` : "action: navigate";
    case "click":
      return `action: click ${quote(ev.name ?? "")}${ev.role ? ` (${ev.role})` : ""}`;
    case "type": {
      const value = ev.sensitive ? REDACTED : ev.text ?? "";
      return `action: type ${quote(value)} into ${quote(ev.name ?? "")}`;
    }
    case "extract":
      // `||` so an empty string also falls back — an empty extract line is invalid.
      return `extract: ${ev.text || ev.name || "content"}`;
  }
}

/** Convert a recorded trace into workflow source text (parser-compatible). */
export function traceToWorkflow(
  trace: readonly RecordedEvent[],
  opts: { site: string; inputs?: string[]; trigger?: string },
): string {
  const frontMatter = ["---", `site: ${opts.site}`];
  if (opts.inputs && opts.inputs.length > 0) {
    frontMatter.push(`inputs: [${opts.inputs.join(", ")}]`);
  }
  if (opts.trigger) frontMatter.push(`trigger: ${opts.trigger}`);
  frontMatter.push("---");

  const steps = trace.map((ev, i) => `${i + 1}. ${stepLine(ev)}`);
  return `${[...frontMatter, ...steps].join("\n")}\n`;
}
