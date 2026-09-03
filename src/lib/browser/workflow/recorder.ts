/**
 * Workflow recorder — recorded action trace → a value-free, replayable workflow
 * (WI-NB7.2 / P-2). The TRUSTED host-side conversion half: it runs in VMark's own
 * webview over events drained from the page-world capture shim, and it is where
 * P-2 redaction is DECIDED — not in the page, which is untrusted.
 *
 * ## P-2, and why it does not trust the page
 *
 * A recorded workflow never contains a typed value or a raw URL. Three rules hold
 * REGARDLESS of anything the page claims, so a hostile page that lies about a
 * field cannot leak a secret:
 *
 *   1. **Typed values never survive.** A `type` on a non-sensitive field becomes a
 *      named `{input}` VARIABLE (the value is supplied at run time, never recorded);
 *      a `type` on a sensitive field becomes a `confirm:` step — a human gate, so the
 *      person re-enters the secret by hand at replay. Either way no literal value is
 *      ever emitted. The `sensitive` hint chooses BETWEEN these two safe forms; it can
 *      never turn a value into a literal, so a forged `sensitive:false` costs nothing.
 *   2. **URLs are always stripped** to origin + path. Query and fragment — where a
 *      token or session id rides — are removed unconditionally, never gated on a flag.
 *   3. **Extract detail is placeholdered** to a fixed string, never the page's text.
 *
 * ## Anti-forgery
 *
 * The workflow file is line-oriented, so a recorded accessible name is page-controlled
 * data in a text format: an unescaped newline would FORGE a step the user never
 * performed. Every recorded name is emitted through `quote` (JSON string escaping —
 * reversible, and it cannot break its line); a recorded role is kept only if it is a
 * clean ARIA token, else dropped; front-matter scalars are validated, not escaped, so
 * a bad `site` fails loudly rather than corrupting the file.
 *
 * A click the shim could not map to an ARIA role becomes a `confirm:` human gate
 * (audit 2026-09-03 S-02): the replayer resolves a click by role + name, so a
 * role-less `click` step would fail on every replay. A role-less `type` keeps its
 * `{input}` form — the executor resolves a field's role from a fresh snapshot.
 *
 * An empty recording yields front-matter with no steps, which the parser reports as
 * `no-steps` — an empty recording is not a runnable workflow.
 *
 * @coordinates-with lib/browser/workflow/parser.ts — output is parseable source; input
 *   names satisfy the parser's own rule AND the stricter executor grammar
 * @coordinates-with lib/browser/workflow/stepGrammar.ts — the executor grammar this emits
 * @coordinates-with lib/browser/agent/recorderShim.src.js — the page-world producer
 * @module lib/browser/workflow/recorder
 */
import { isValidInputName } from "./parser";
import { urlForAgent } from "../url";

/** One recorded user action, as drained from the page-world shim (click/type) or
 *  synthesized host-side from a navigation event. Deliberately carries NO typed
 *  value — the shim never records one, and this converter never emits one. */
export interface RecordedEvent {
  type: "navigate" | "click" | "type" | "extract";
  /** Target URL, for `navigate` (host-supplied; stripped to origin+path here). */
  url?: string;
  /** ARIA role of the target, for click/type. */
  role?: string;
  /** Accessible name of the target (click/type). Unused for extract (placeholdered). */
  name?: string;
  /** For `type`: the page-world HINT that the field is a secret. Chooses confirm vs
   *  input ONLY — never whether a value survives (it never does). Untrusted. */
  sensitive?: boolean;
}

/** Fixed placeholder for an extracted region — the page's own detail is never kept. */
const EXTRACT_PLACEHOLDER = "content";
/** Bound a hostile or absurd accessible name before it reaches a locator or a slug. */
const MAX_NAME = 120;

/** Encode a recorded value as a quoted scalar. JSON escaping is reversible and escapes
 *  line breaks, so page content cannot break out of its line and forge a step. */
function quote(value: string): string {
  return JSON.stringify(value.slice(0, MAX_NAME));
}

/** Fold line breaks out of an unquoted field: page content must not start a new line
 *  (and therefore a new step) in a line-oriented file. */
function fold(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_NAME);
}

/** A recorded role is page data, appended unquoted as `(role)`. Keep only a clean ARIA
 *  token — lowercased, because that is the replayer's vocabulary (`aria.ts` lowercases
 *  an explicit `role` attribute and the executor grammar accepts `[a-z]+` only); anything
 *  else (a newline, `)`, `"`, a hyphen) drops the role so the line cannot be corrupted. */
function safeRole(role: string | undefined): string {
  const lowered = role?.trim().toLowerCase() ?? "";
  return /^[a-z]+$/.test(lowered) ? lowered : "";
}

/** `"name" (role)` — the one target format for click AND type. */
function locator(name: string | undefined, role: string | undefined): string {
  const r = safeRole(role);
  return `${quote(name ?? "")}${r ? ` (${r})` : ""}`;
}

/** Strip a URL to origin + path. Query and fragment are ALWAYS removed (P-2 rule 2 —
 *  a callback URL carries tokens). A non-http(s) or unparseable URL degrades to "" (a
 *  bare `navigate`), never passed through. */
function stripUrl(raw: string | undefined): string {
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  // The same redactor the agent sees (userinfo, query and fragment gone), so the two
  // security-sensitive implementations cannot drift. Then the PATH: a reset, magic-login
  // or invite link carries its token there, and a recorded workflow is an artifact that
  // outlives the session — such a navigation is kept as its origin only.
  const redacted = urlForAgent(u.href);
  const path = u.pathname;
  if (CREDENTIAL_PATH.test(path) || path.split("/").some((seg) => TOKEN_SEGMENT.test(seg))) {
    return u.origin;
  }
  return redacted;
}

/** Path words that name a credential-bearing flow. */
const CREDENTIAL_PATH = /(^|\/)(reset|reset-password|magic|magic-link|magic-login|token|verify|confirm|invite|activate|auth|callback|sso)(\/|$)/i;
/** A long opaque segment: hex, base64url or a random id — the shape a token takes. */
const TOKEN_SEGMENT = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{20,}$/;

/** Derive a variable name from a field label. NFKC-normalized, non-alphanumerics
 *  collapsed to `_`, forced to start with a letter/underscore. The result satisfies
 *  BOTH the parser's name rule and the stricter executor grammar (`[A-Za-z_][A-Za-z0-9_]*`,
 *  no hyphens). An unnameable field falls back to `field_<position>`. */
function slugFor(label: string | undefined, oneBasedIndex: number): string {
  const base = (label ?? "").normalize("NFKC");
  let s = base.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[A-Za-z_]/.test(s)) s = s ? `field_${s}` : "";
  if (s === "") s = `field_${oneBasedIndex}`;
  return s.slice(0, 60);
}

/** Make `slug` unique against names already used, appending `_2`, `_3`, … */
function uniqueName(slug: string, used: Set<string>): string {
  let candidate = slug;
  let n = 2;
  while (used.has(candidate)) candidate = `${slug}_${n++}`;
  used.add(candidate);
  return candidate;
}

/** A front-matter scalar is written verbatim to the end of its line: a blank or
 *  multi-line value would drop the field or terminate the block. Fail loudly. */
function requireScalar(field: string, value: string): string {
  if (value.trim() === "" || /[\r\n]/.test(value)) {
    throw new TypeError(`recordingToWorkflow: "${field}" must be a non-empty single-line value.`);
  }
  return value.trim();
}

/** Serialize `inputs: [a, b]` under the parser's OWN name rule — a defensive check;
 *  every name here was produced by `slugFor`, which already satisfies it. */
function serializeInputs(inputs: readonly string[]): string {
  for (const name of inputs) {
    if (!isValidInputName(name)) {
      throw new TypeError(`recordingToWorkflow: invalid input name "${name}".`);
    }
  }
  return `inputs: [${inputs.join(", ")}]`;
}

/** Options for a recording conversion. `inputs` are DERIVED, never supplied. */
export interface RecordingOptions {
  /** Site id the workflow targets (front-matter `site:`). */
  site: string;
  /** Optional trigger descriptor (front-matter `trigger:`), e.g. "manual". */
  trigger?: string;
}

/** The converted workflow plus the input names it declares (for the recorder UI). */
export interface RecordingResult {
  source: string;
  inputs: string[];
}

/** Convert a recorded trace into value-free, parser-compatible workflow source (P-2).
 *  Throws `TypeError` only on an unserializable `site`/`trigger` (see `requireScalar`). */
export function recordingToWorkflow(
  events: readonly RecordedEvent[],
  opts: RecordingOptions,
): RecordingResult {
  const inputs: string[] = [];
  const used = new Set<string>();
  const stepLines: string[] = [];

  events.forEach((ev, i) => {
    switch (ev.type) {
      case "navigate": {
        const url = stripUrl(ev.url);
        stepLines.push(url ? `action: navigate to ${url}` : "action: navigate");
        break;
      }
      case "click": {
        // A role-less click is a dead production for the replayer: `role:""` never
        // matches an element and heal never crosses roles (audit S-02). Hand it to the
        // human instead of recording a step that fails on every replay.
        if (safeRole(ev.role) === "") {
          stepLines.push(
            `confirm: click ${quote(fold(ev.name ?? ""))} by hand — the recorder could not map it to an ARIA control`,
          );
          break;
        }
        stepLines.push(`action: click ${locator(ev.name, ev.role)}`);
        break;
      }
      case "type": {
        if (ev.sensitive) {
          // A secret: a human gate, never a variable and never a literal. The label is
          // folded prose so it cannot forge a step; the value never existed here.
          stepLines.push(`confirm: enter ${quote(fold(ev.name ?? "the requested value"))}`);
        } else {
          const name = uniqueName(slugFor(ev.name, i + 1), used);
          inputs.push(name);
          stepLines.push(`action: type {${name}} into ${locator(ev.name, ev.role)}`);
        }
        break;
      }
      case "extract":
        stepLines.push(`extract: ${EXTRACT_PLACEHOLDER}`);
        break;
    }
  });

  const frontMatter = ["---", `site: ${requireScalar("site", opts.site)}`];
  if (inputs.length > 0) frontMatter.push(serializeInputs(inputs));
  if (opts.trigger) frontMatter.push(`trigger: ${requireScalar("trigger", opts.trigger)}`);
  frontMatter.push("---");

  const numbered = stepLines.map((line, i) => `${i + 1}. ${line}`);
  return { source: `${[...frontMatter, ...numbered].join("\n")}\n`, inputs };
}
