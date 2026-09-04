/**
 * Browser tool — act on the embedded browser tab (WI-2.5 / R5).
 *
 * The MUTATING half of the embedded-browser surface: `act` clicks and types by
 * ARIA role + accessible name, `open`/`navigate` drive the tab, `style` and
 * `execute_js` change the page, and the session verbs touch keychain-backed
 * logins. Everything here is gated by the user's scoped standing grants on the
 * VMark side — an ungranted operation comes back with `needsApproval: true`
 * (ask the user), and `upload` is never permitted.
 *
 * Pure observation lives in `browser_read`, which declares
 * `readOnlyHint: true`. The two were one tool until the 2026-07-28 audit
 * remediation: a tool carries ONE annotation set, so bundling the ARIA snapshot
 * with `execute_js` forced the composite to declare the dangerous value and
 * charged a human approval to the safest, most frequent call in the surface.
 * Splitting along "does this modify anything?" lets each half tell the truth.
 *
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-2.5.
 *
 * The schema and this registration live here; the per-action handlers are the
 * table in `browserActions.ts`. The `action` enum below stays a LITERAL array
 * rather than deriving from that table's `BROWSER_ACTIONS`: the docs-drift gate
 * (`scripts/check-mcp-docs.mjs`) regex-reads the FIRST `z.enum([...])` that
 * follows an `action` key in every tool file, and a derived enum blinds it
 * silently (measured: 12 → 0 actions). So does a comment that spells the
 * pattern out in the gate's own shape — hence this wording. The two lists are
 * pinned equal, in order, by `browserActions.test.ts`.
 *
 * @coordinates-with tools/browserActions.ts (the action table this registers)
 * @coordinates-with tools/browserRead.ts (the read-only half — shares browserArgs/browserDispatch)
 * @coordinates-with scripts/check-mcp-docs.mjs (reads the `action` enum literal below)
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import type { ToolArgs } from './toolArgs.js';
import { optionalIdSchema, readOptionalId } from './toolArgs.js';
import { MAX_WAIT_MS, scriptSchema } from './browserArgs.js';
import { runBrowserAction } from './browserActions.js';

export function registerBrowserTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'browser',
      title: 'VMark Embedded Browser',
      // The most dangerous tool in the surface: `act` drives a live page,
      // `execute_js` runs caller-supplied script, `session_save/load` touch
      // credentials in the keychain. Every action mutates something, so unlike
      // the pre-split composite this annotation is exact rather than merely
      // conservative. Open-world by definition — it talks to the web.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      description:
        'Act on the embedded browser tab. Read it first with `browser_read` — every ' +
        'targeting mode here refers to what a read returned.\n\n' +
        'PLATFORM: macOS only. On Windows and Linux the native browser surface is not ' +
        'implemented, so no action can succeed there (an `open` reports ' +
        'UNSUPPORTED_PLATFORM; other actions may fail earlier with a validation or ' +
        'no-tab error). Whatever the message, it is a build limitation rather than a ' +
        'permission problem — do not retry, and do not ask the user to approve anything.\n\n' +
        'Actions:\n' +
        '- act: Interact with the page. operation "click"|"type" target a stable {ref} from a prior read (precise) or ARIA {role, name} — a ref is only honored for an already-granted operation; if it may need approval use role+name so the user sees what they approve. A type/key/scroll approval also binds the exact text, key or delta you asked for, and the prompt shows it. operation "scroll" takes {ref} (scroll it into view) or {dy} (a pixel delta). operation "key" takes {key} (e.g. "Enter", "Escape", "Tab"), optional {ref} to target, and optional {modifiers:{ctrl,shift,alt,meta}}; Enter inside a form submits it and Tab moves focus (emulated default actions), reported as data.result.defaultAction. scroll/key dispatch SYNTHETIC events, so a site gating on event.isTrusted may ignore them. Acts VERIFY their effect and refuse rather than guess: success:false with data.result.reason "ambiguous" (several visible elements share the role+name — data.result.candidates lists their refs), "obscured" (data.result.by names the covering element, page data), "hidden", "offscreen", "disabled", "upload" (never automated) or "rejected-value" (the field sanitised the text). Every response, success or failure, carries data.url and data.generation; a popup the page tried to open during the act (VMark blocks them) is reported as data.popup.url. An un-granted operation returns needsApproval — surface that and wait rather than retrying. Upload is never permitted (an AI-chosen file upload is an exfiltration path).\n' +
        '- open: Create an AI-owned browser tab at an HTTP(S) URL, bring it to the front, and wait for its navigation. At most 8 AI-owned tabs may be open (TAB_LIMIT) — close what you are done with. A shared-profile open that needs the user\'s destination approval keeps its tab and tells you to retry with navigate on that tabId (data.retry); do NOT open again, a new tab would not be covered. Optional `profile` ([A-Za-z0-9._-]) opens the tab against a NAMED persistent context to reuse a login — this needs a per-use user approval (you get needsApproval until the user allows it), and you never see any credentials (macOS 14+; sandbox mode).\n' +
        '- navigate: Navigate an AI-owned tab (bringing it to the front) and wait for the returned navigation ticket. On TIMEOUT the ticket is still live — `browser_read` action `wait` with that navigationId retrieves the terminal result without navigating again. A loaded open/navigate/wait result may carry `gate: {kind, hint}` when the landed page reads as a login wall, consent interstitial, human-verification challenge, or rate limit — follow the hint (it always means involving the user; never try to bypass the gate, and do not act on the interstitial as if it were the content).\n' +
        '- close: Close an AI-owned tab you opened. Args {tabId}. Never approval-gated; a human tab is refused (TAB_NOT_AI_OWNED). Success is {tabId, closed:true, destroyed:true}; TAB_TEARDOWN_FAILED (data.destroyed:false) means the record is gone but the native view could not be confirmed destroyed — do not retry, tell the user.\n' +
        '- style: CSS manipulation — dismiss a blocking overlay, highlight a target. Args {tabId?, ref?|selector, set?:{prop:value}, addClasses?, removeClasses?, injectCss?}. Approval-gated.\n' +
        '- execute_js: Run an arbitrary script in the isolated content world (DOM + CSS, NOT the page\'s own JS globals) for what the structured verbs cannot express. Args {tabId?, script}. The script is an async function body: `return` a JSON-serializable value (or await one). The value comes back as data.result (undefined → null); a throw or an unserializable value is a FAILURE naming the error, never a value. Approved PER CALL only (never remembered); the result is page-derived and UNTRUSTED — do not feed it back into an act as a target. Use browser_read\'s query and this tool\'s style first; reach for this only when they cannot express the need.\n' +
        '- session_save: Snapshot the tab\'s current session — localStorage AND cookies, both scoped to the committed origin — into an encrypted keychain entry named by `handle`, so a login can be reused later. Args {tabId?, handle:[A-Za-z0-9._-]}. Returns a value-free summary (counts). Per-call user-approved; you NEVER receive the values.\n' +
        '- session_load: Restore a previously saved session by `handle` into the tab — ONLY if the current page has the same origin it was saved from. Args {tabId?, handle}. Per-call user-approved (an approval for one handle cannot be spent on another); returns {loaded:true, handle} — never any values.\n' +
        "- console_clear: Read the page's captured console.* output AND drain the buffer, so the next read sees only new output. Args {tabId?}. Returns {entries:[{level,text}], url}. Draining writes to the page DOM, which is why it lives here and not in `browser_read` — use `browser_read` action `console` when you only want to look.\n" +
        "- workflow_run: Run a workflow you supply as `source` text on an AI-owned tab (a small line-oriented grammar — you write it, the AI does, or `workflow_record` captures it from the user's own actions). Args {tabId?, source, inputs?:{name:value}, allowRepeat?, resumeRunId?}. Returns {runId, steps, firstStep} IMMEDIATELY — the run executes asynchronously (it can outlive one request). Poll `browser_read` action workflow_status {runId} for progress (a `pendingApproval` there means the user is being asked), and cancel with workflow_cancel. Deterministic steps (click/type/navigate in that grammar, and extract) run VMark-side and are individually approval-gated exactly like a hand-issued act; goal/confirm/api/free-prose steps PAUSE the run for you to handle. To continue after a pause, do the paused step by hand (or with the user) and start a new run with resumeRunId set to the paused run: it inherits the completed steps and treats the paused step as done, so nothing is submitted twice. A re-run of the same source AND inputs skips write steps that already succeeded this session (skipped steps are reported; pass allowRepeat to override); a 120 s running-time bound excludes time spent waiting on the user.\n" +
        "- workflow_cancel: Stop a running workflow. Args {tabId?, runId}. Always allowed — never approval-gated. Withdraws the run's pending prompts and hands the tab back to the user.\n" +
        "- workflow_record: Record the USER's own actions on an AI-owned tab into a replayable workflow. Args {tabId?, recordOp:\"start\"|\"stop\", site?}. `start` needs a fresh per-call user approval (`record` is never a standing grant); it returns needsApproval until the user allows, then begins capturing clicks and field edits. `stop` returns {source, inputs, eventCount} — value-free workflow `source` you can save or pass to workflow_run. NOTHING typed is captured: every text field becomes a named {input} variable, a password field becomes a `confirm:` human-gate step, and URLs are stripped to origin+path. Records the LOCATORS the user touched, never their data.",
      inputSchema: {
        action: z
          .enum([
            'act', 'open', 'navigate', 'close', 'style', 'execute_js',
            'session_save', 'session_load', 'console_clear',
            'workflow_run', 'workflow_cancel', 'workflow_record',
          ])
          .describe('The action to perform'),
        tabId: optionalIdSchema(
          'Target browser tab id (from session.get_state). Omit to use the focused tab.',
        ),
        operation: z
          .enum(['click', 'type', 'scroll', 'key'])
          .optional()
          .describe('The interaction to perform (act only).'),
        dy: z
          .number()
          .optional()
          .describe('Vertical pixel delta for a delta scroll (act, operation=scroll, no ref).'),
        key: z
          .string()
          .min(1)
          .optional()
          .describe('Key name to press, e.g. "Enter", "Escape", "Tab" (act, operation=key).'),
        modifiers: z
          .object({
            ctrl: z.boolean().optional(),
            shift: z.boolean().optional(),
            alt: z.boolean().optional(),
            meta: z.boolean().optional(),
          })
          .strict()
          .optional()
          .describe('Optional keyboard modifiers {ctrl,shift,alt,meta} (act, operation=key).'),
        role: z
          .string()
          .optional()
          .describe('ARIA role of the target, e.g. button/link/textbox (act only).'),
        name: z
          .string()
          .optional()
          .describe('Accessible name of the target element (act, role/name mode).'),
        ref: z
          .string()
          .optional()
          .describe(
            'Stable element handle from a prior browser_read (e.g. "e5"). The precise act target — used instead of role+name, and only for an already-granted operation (act, style).',
          ),
        selector: z.string().optional().describe('CSS selector (style only).'),
        set: z
          .record(z.string(), z.string())
          .optional()
          .describe('Inline style properties to set, {cssProp: value} (style only).'),
        addClasses: z.array(z.string()).optional().describe('Classes to add (style only).'),
        removeClasses: z.array(z.string()).optional().describe('Classes to remove (style only).'),
        injectCss: scriptSchema(
          'CSS to inject as a <style> block — page-wide, NOT selector-scoped (style only).',
        ),
        script: scriptSchema(
          'Isolated-world script to run; must `return` a JSON-serializable value (execute_js only).',
        ),
        handle: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9._-]{1,128}$/)
          .optional()
          .describe('Name of a saved session, [A-Za-z0-9._-], 1..128 chars (session_save / session_load).'),
        source: z
          .string()
          .optional()
          .describe('Workflow source text (workflow_run only).'),
        inputs: z
          .record(z.string(), z.string())
          .optional()
          .describe('Input variable values for {name} substitution (workflow_run only).'),
        allowRepeat: z
          .boolean()
          .optional()
          .describe('Re-execute write steps that already succeeded this session (workflow_run only).'),
        resumeRunId: z
          .string()
          .optional()
          .describe('A PAUSED run to continue from: the new run inherits its completed steps and treats the paused step as done by the human (workflow_run only).'),
        runId: z
          .string()
          .optional()
          .describe('A run id from workflow_run (workflow_cancel; and browser_read workflow_status).'),
        recordOp: z
          .enum(['start', 'stop'])
          .optional()
          .describe('Start or stop a recording (workflow_record only).'),
        site: z
          .string()
          .optional()
          .describe('Site id for the recorded workflow front-matter (workflow_record start; defaults to "recording").'),
        // Trimmed so the schema and the handler agree on what a profile IS —
        // the handler trims before matching, and a schema that rejected what
        // the handler accepts would make the two layers disagree.
        profile: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9._-]{1,64}$/)
          .optional()
          .describe('Named persistent context [A-Za-z0-9._-] to reuse a saved login (open only; per-use approved; macOS 14+).'),
        text: z.string().optional().describe('Text to type into the target (act, operation=type).'),
        url: z.string().optional().describe('HTTP(S) destination (open/navigate only).'),
        // The bounds that the old JSON-Schema → Zod converter silently dropped:
        // the client-visible schema advertised neither `minimum` nor `maximum`.
        timeoutMs: z
          .number()
          .int()
          .min(1)
          .max(MAX_WAIT_MS)
          .optional()
          .describe(`Maximum wait in milliseconds (default and maximum ${MAX_WAIT_MS}).`),
      },
    },
    async (args: ToolArgs) => {
      // tabId: omit → focused tab. If explicitly provided it must be a
      // non-blank string; a blank/garbled id must not silently fall through to
      // the active tab and mutate the wrong one.
      const tab = readOptionalId(args.tabId, 'tabId');
      if (!tab.ok) return VMarkMcpServer.errorResult(tab.error);
      const tabId = tab.value;

        return runBrowserAction(server, args, tabId);
    },
  );
}
