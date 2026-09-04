/**
 * Browser-operation request schemas (WI-NB4.1) — split from
 * `operationSchemas.ts` for the file-size gate, along the tool boundary. Same
 * contract discipline: schemas MIRROR the wire exactly (the handler validates
 * combinations); regenerate with `pnpm gen:mcp-contracts` after any change.
 *
 * @coordinates-with server/mcp/src/bridge/operationSchemas.ts — spreads this map
 * @coordinates-with server/mcp/src/bridge/operationSchemas.primitives.ts — the shared spellings
 * @module bridge/operationSchemas.browser
 */
import { z } from 'zod';
import { id, optionalTabId } from './operationSchemas.primitives.js';

// `timeoutMs` is a browser-only spelling, so it stays beside its users.
const timeoutMs = z.number().optional();

export const BROWSER_OPERATION_SCHEMAS = {
  'vmark.browser.read': z.object({ tabId: optionalTabId }),
  // `act` targets EITHER a precise `ref` OR an ARIA `role`+`name`, and for
  // scroll/key carries `dy`/`key`/`modifiers` — so every target field is
  // optional here and the handler validates the combination.
  'vmark.browser.act': z.object({
    tabId: optionalTabId,
    operation: z.string(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    ref: z.string().optional(),
    dy: z.number().optional(),
    key: z.string().optional(),
    // `.strict()` does not recurse from the outer schema: an unknown modifier such
    // as `command` passed contract checking and was silently dropped, dispatching an
    // UNMODIFIED key action. The nested object rejects unknown keys itself.
    modifiers: z
      .object({
        ctrl: z.boolean().optional(),
        shift: z.boolean().optional(),
        alt: z.boolean().optional(),
        meta: z.boolean().optional(),
      })
      .strict()
      .optional(),
  }),
  'vmark.browser.open': z.object({
    url: id,
    timeoutMs,
    profile: z.string().optional(),
  }),
  'vmark.browser.navigate': z.object({ tabId: optionalTabId, url: id, timeoutMs }),
  'vmark.browser.wait': z.object({
    tabId: optionalTabId,
    navigationId: z.string().optional(),
    timeoutMs,
  }),
  'vmark.browser.wait_for': z.object({
    tabId: optionalTabId,
    ref: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    urlContains: z.string().optional(),
    timeoutMs,
  }),
  'vmark.browser.screenshot': z.object({ tabId: optionalTabId }),
  'vmark.browser.query': z.object({
    tabId: optionalTabId,
    selector: id,
    fields: z.unknown().optional(),
  }),
  'vmark.browser.style': z.object({
    tabId: optionalTabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    set: z.record(z.string(), z.string()).optional(),
    addClasses: z.array(z.string()).optional(),
    removeClasses: z.array(z.string()).optional(),
    injectCss: z.string().optional(),
  }),
  'vmark.browser.execute_js': z.object({ tabId: optionalTabId, script: id }),
  'vmark.browser.session.save': z.object({ tabId: optionalTabId, handle: id }),
  'vmark.browser.session.load': z.object({ tabId: optionalTabId, handle: id }),
  'vmark.browser.console': z.object({ tabId: optionalTabId, clear: z.boolean().optional() }),
  'vmark.browser.extract': z.object({ tabId: optionalTabId }),
  // Close an AI-owned tab (audit 2026-09-03 X-01). Never approval-gated.
  'vmark.browser.close': z.object({ tabId: id }),
  'vmark.browser.workflow_run': z.object({
    tabId: optionalTabId,
    source: id,
    inputs: z.record(z.string(), z.string()).optional(),
    allowRepeat: z.boolean().optional(),
    // Resume a PAUSED run (audit 2026-09-03 W-05): the new run inherits its
    // completed steps and treats the paused-at step as done by the human.
    resumeRunId: z.string().optional(),
  }),
  'vmark.browser.workflow_status': z.object({ tabId: optionalTabId, runId: id }),
  'vmark.browser.workflow_cancel': z.object({ tabId: optionalTabId, runId: id }),
  // `recordOp` is "start" | "stop" — kept a plain string here (the bridge-contract
  // generator has no enum form); the handler validates the two values.
  'vmark.browser.workflow_record': z.object({
    tabId: optionalTabId,
    recordOp: id,
    site: z.string().optional(),
  }),
} as const;
