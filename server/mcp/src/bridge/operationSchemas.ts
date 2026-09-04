/**
 * Per-operation wire schemas — the SINGLE SOURCE OF TRUTH for MCP bridge
 * payloads (WI-15).
 *
 * The same 34 payload contracts used to be hand-written in three places: the
 * `BridgeRequest` union here in the sidecar, an untyped pass-through in Rust
 * (`types.rs` forwards every non-`type` key as args), and per-field `typeof`
 * narrowing in each webview handler. Four copies that agreed today are not a
 * contract — they are four chances to drift, and one of them had already
 * drifted: Rust routed on `args.windowId`, a key no tool sends and no copy
 * declared.
 *
 * Everything downstream is now GENERATED from this module by
 * `pnpm gen:mcp-contracts`:
 *   - `generated/bridgeRequests.ts` — the `BridgeRequest` union re-exported
 *     from `core-types.ts`,
 *   - `src/services/mcpBridge/v2/generated/bridgeContracts.ts` — the webview
 *     field descriptors, argument types, and unknown-field posture.
 *
 * @coordinates-with ../../scripts/gen-mcp-contracts.ts — the generator
 * @coordinates-with ../server.ts — validates every outbound request here
 * @coordinates-with ./operationSchemas.primitives.ts — the field spellings shared with the browser map
 */

import { z } from 'zod';
import { BROWSER_OPERATION_SCHEMAS } from './operationSchemas.browser.js';
import { id, optionalTabId } from './operationSchemas.primitives.js';

/**
 * What an operation does with a field its schema does not declare.
 *
 * Ledger `.claude/tdd-guardian/decisions-20260803.md` D5: there is no single
 * right answer, so the posture is chosen per boundary CLASS and asserted per
 * class in `__tests__/unit/bridge/operationPosture.test.ts`.
 */
export type UnknownFieldPosture = 'reject' | 'strip-and-log';

/** Operation namespace — the class the posture is chosen for. */
export type OperationClass =
  | 'session'
  | 'workspace'
  | 'document'
  | 'workflow'
  | 'selection'
  | 'browser'
  | 'coherence';

/**
 * Unknown-field posture per class, with the reason it is what it is.
 *
 * Everything that can select a TARGET — a window, a workspace, a tab —
 * REJECTS. A field the caller believed was routing them somewhere, silently
 * dropped, is precisely the `windowId` failure: the request lands on whatever
 * was focused and the caller is told nothing. Wrong-target writes are the
 * worst failure this surface has, so the refusal is loud.
 *
 * `session` is the exception, and only because its single field exists to
 * survive version skew: `clientProtocol` is how a client declares what it
 * speaks. A newer client that also declares something this build has never
 * heard of must still get its session state, so unknown fields are dropped —
 * but logged, never silently, so a field that should have been routed cannot
 * hide there either.
 */
export const OPERATION_CLASS_POSTURE: Readonly<Record<OperationClass, UnknownFieldPosture>> =
  Object.freeze({
    session: 'strip-and-log',
    workspace: 'reject',
    document: 'reject',
    workflow: 'reject',
    selection: 'reject',
    browser: 'reject',
    coherence: 'reject',
  });

/** The class an operation belongs to (`vmark.<class>.<action>`). */
export function operationClass(operation: string): OperationClass {
  const cls = operation.split('.')[1];
  if (!(cls in OPERATION_CLASS_POSTURE)) {
    throw new Error(`operation '${operation}' has no known class`);
  }
  return cls as OperationClass;
}

/** Posture for one operation, derived from its class. */
export function postureFor(operation: string): UnknownFieldPosture {
  return OPERATION_CLASS_POSTURE[operationClass(operation)];
}

// `id` / `optionalTabId` come from the primitives module (shared with the
// browser map); `revision` is used by this map alone, so it lives here.
const revision = z.string().optional();

/**
 * Every `vmark.*` operation and the fields its payload carries.
 *
 * Schemas mirror the wire contract EXACTLY as shipped — they are the one
 * declaration of it, not a tightening of it. Narrowing a field (say, making
 * `browser.act`'s `operation` an enum) is a protocol change and belongs in its
 * own change, where the app side moves with it.
 */
export const BRIDGE_OPERATION_SCHEMAS = {
  // ── Session ──
  'vmark.session.get_state': z.object({ clientProtocol: z.string().optional() }),

  // ── Workspace ──
  'vmark.workspace.new': z.object({
    kind: z.string().optional(),
    windowLabel: z.string().optional(),
  }),
  'vmark.workspace.open': z.object({
    filePath: id,
    windowLabel: z.string().optional(),
  }),
  // No `windowLabel`: the handler deliberately binds to the window the
  // request arrived on, so a client-supplied label could show the approval
  // prompt in one window while mutating another. The field was declared here
  // for a year, sent by nothing and read by nothing (WI-15 RED, drift 3).
  'vmark.workspace.open_workspace': z.object({ folderPath: id }),
  'vmark.workspace.save': z.object({ tabId: optionalTabId }),
  'vmark.workspace.save_as': z.object({ tabId: optionalTabId, filePath: id }),
  'vmark.workspace.close': z.object({ tabId: id, force: z.boolean().optional() }),
  'vmark.workspace.switch_tab': z.object({ tabId: id }),
  'vmark.workspace.focus_window': z.object({ windowLabel: id }),

  // ── Document ──
  'vmark.document.read': z.object({ tabId: optionalTabId }),
  'vmark.document.write': z.object({
    tabId: optionalTabId,
    content: z.string(),
    expected_revision: revision,
    save: z.boolean().optional(),
  }),
  'vmark.document.transform': z.object({
    tabId: optionalTabId,
    kind: z.string(),
    expected_revision: revision,
  }),

  // ── Workflow ──
  // `patches` stays `unknown[]`: the IRPatch discriminated union lives in the
  // app (`src/lib/ghaWorkflow/save/mutators.ts`) and duplicating it here would
  // recreate the very drift this module exists to end.
  'vmark.workflow.apply_patch': z.object({
    tabId: optionalTabId,
    patches: z.array(z.unknown()),
    expected_revision: revision,
  }),
  'vmark.workflow.validate': z.object({ tabId: optionalTabId }),

  // ── Selection ──
  'vmark.selection.get': z.object({ tabId: optionalTabId }),
  'vmark.selection.set': z.object({
    tabId: optionalTabId,
    content: z.string(),
    expected_revision: revision,
  }),

  // ── Browser (split for the file-size gate) ──
  ...BROWSER_OPERATION_SCHEMAS,

  // ── Coherence (answered entirely in Rust; no webview hop) ──
  'vmark.coherence.status': z.object({ workspace_root: id }),
  'vmark.coherence.edges': z.object({ workspace_root: id }),
  'vmark.coherence.claims': z.object({ workspace_root: id }),
  'vmark.coherence.contexts': z.object({ workspace_root: id }),
  'vmark.coherence.resolve': z.object({
    workspace_root: id,
    txf: z.unknown(),
    input: z.unknown(),
    resolution: z.unknown(),
    reason: z.unknown().optional(),
  }),
} as const;

/** Every `vmark.*` operation name, as a literal union. */
export type BridgeOperationName = keyof typeof BRIDGE_OPERATION_SCHEMAS;

/** Operation names in a stable (sorted) order — generators must not depend on
 *  object-literal declaration order. */
export function operationNames(): BridgeOperationName[] {
  return (Object.keys(BRIDGE_OPERATION_SCHEMAS) as BridgeOperationName[]).sort();
}

/** Outcome of checking one payload against its operation schema. */
export interface ContractCheck {
  /** Set when the payload must not be sent at all. */
  readonly error: string | null;
  /** Set when the payload carried unknown fields a `strip-and-log` class tolerates. */
  readonly warning: string | null;
}

const IN_CONTRACT: ContractCheck = Object.freeze({ error: null, warning: null });

/**
 * Check one outbound bridge request against its operation schema.
 *
 * Never transforms the request. A `strip-and-log` operation reports its
 * unknown fields as a WARNING rather than dropping them silently — silence is
 * how a field that should have routed somewhere disappears without a trace,
 * which is the defect this whole module exists to end.
 */
export function checkOutboundRequest(request: { type: string }): ContractCheck {
  const schema = BRIDGE_OPERATION_SCHEMAS[request.type as BridgeOperationName];
  if (!schema) {
    return { error: `unknown bridge operation '${request.type}'`, warning: null };
  }
  const { type: _type, ...args } = request as Record<string, unknown> & { type: string };
  const strict = schema.strict().safeParse(args);
  if (strict.success) return IN_CONTRACT;

  const unknownKeys = strict.error.issues
    .filter((issue) => issue.code === 'unrecognized_keys')
    .flatMap((issue) => (issue as { keys?: string[] }).keys ?? []);
  const others = strict.error.issues.filter((issue) => issue.code !== 'unrecognized_keys');
  const describe = (): string =>
    strict.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');

  if (postureFor(request.type) === 'reject' || others.length > 0) {
    return {
      error: `bridge request '${request.type}' is out of contract — ${describe()}`,
      warning: null,
    };
  }
  return {
    error: null,
    warning:
      `bridge request '${request.type}' carried undeclared field(s) ` +
      `${unknownKeys.sort().join(', ')} — forwarded, but the contract does not declare them`,
  };
}
