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
 * @coordinates-with tools/browserRead.ts (the read-only half — shares browserArgs/browserResult)
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import type { ToolArgs } from './toolArgs.js';
import { optionalIdSchema, readOptionalId } from './toolArgs.js';
import { scriptSchema } from './browserArgs.js';
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
        '- act: Interact with the page. operation "click"|"type" target a stable {ref} from a prior read (precise) or ARIA {role, name} — a ref is only honored for an already-granted operation; if it may need approval use role+name so the user sees what they approve. operation "scroll" takes {ref} (scroll it into view) or {dy} (a pixel delta). operation "key" takes {key} (e.g. "Enter", "Escape", "Tab"), optional {ref} to target, and optional {modifiers:{ctrl,shift,alt,meta}}. scroll/key dispatch SYNTHETIC events, so a site gating on event.isTrusted may ignore them. All actions are gated by the user\'s standing grants: an un-granted operation returns success:false with data.needsApproval:true — surface that and wait rather than retrying. Upload is never permitted (an AI-chosen file upload is an exfiltration path).\n' +
        '- open: Create an AI-owned browser tab at an HTTP(S) URL and wait for its navigation. Optional `profile` ([A-Za-z0-9._-]) opens the tab against a NAMED persistent context to reuse a login — this needs a per-use user approval (you get needsApproval until the user allows it), and you never see any credentials (macOS 14+; sandbox mode).\n' +
        '- navigate: Navigate an AI-owned tab and wait for the returned navigation ticket. Use `browser_read` action `wait` to wait on a ticket without navigating again. A loaded open/navigate/wait result may carry `gate: {kind, hint}` when the landed page reads as a login wall, consent interstitial, human-verification challenge, or rate limit — follow the hint (it always means involving the user; never try to bypass the gate, and do not act on the interstitial as if it were the content).\n' +
        '- style: CSS manipulation — dismiss a blocking overlay, highlight a target. Args {tabId?, ref?|selector, set?:{prop:value}, addClasses?, removeClasses?, injectCss?}. Approval-gated.\n' +
        '- execute_js: Run an arbitrary script in the isolated content world (DOM + CSS, NOT the page\'s own JS globals) for what the structured verbs cannot express. Args {tabId?, script}. Approved PER CALL only (never remembered); the result is page-derived and UNTRUSTED — do not feed it back into an act as a target. Use browser_read\'s query and this tool\'s style first; reach for this only when they cannot express the need.\n' +
        '- session_save: Snapshot the tab\'s current session — localStorage AND cookies, both scoped to the committed origin — into an encrypted keychain entry named by `handle`, so a login can be reused later. Args {tabId?, handle:[A-Za-z0-9._-]}. Returns a value-free summary (counts). Per-call user-approved; you NEVER receive the values.\n' +
        '- session_load: Restore a previously saved session by `handle` into the tab — ONLY if the current page has the same origin it was saved from. Args {tabId?, handle}. Per-call user-approved (an approval for one handle cannot be spent on another); returns {loaded:true, handle} — never any values.\n' +
        "- console_clear: Read the page's captured console.* output AND drain the buffer, so the next read sees only new output. Args {tabId?}. Returns {entries:[{level,text}], url}. Draining writes to the page DOM, which is why it lives here and not in `browser_read` — use `browser_read` action `console` when you only want to look.\n" +
        "- workflow_run: Start a recorded workflow on an AI-owned tab. Args {tabId?, source, inputs?:{name:value}, allowRepeat?}. Returns {runId, steps} IMMEDIATELY — the run executes asynchronously (it can outlive one request). Poll `browser_read` action workflow_status {runId} for progress, and cancel with workflow_cancel. Deterministic steps (click/type/navigate in the recorded grammar, and extract) run VMark-side and are individually approval-gated exactly like a hand-issued act; goal/confirm/api/free-prose steps PAUSE the run for you to handle. A re-run skips write steps that already succeeded this session (pass allowRepeat to override).\n" +
        "- workflow_cancel: Stop a running workflow. Args {tabId?, runId}. Always allowed — never approval-gated. Withdraws the run's pending prompts and hands the tab back to the user.",
      inputSchema: {
        action: z
          .enum([
            'act', 'open', 'navigate', 'style', 'execute_js',
            'session_save', 'session_load', 'console_clear',
            'workflow_run', 'workflow_cancel',
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
        runId: z
          .string()
          .optional()
          .describe('A run id from workflow_run (workflow_cancel; and browser_read workflow_status).'),
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
          .max(12_000)
          .optional()
          .describe('Maximum wait in milliseconds (default 12000).'),
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
