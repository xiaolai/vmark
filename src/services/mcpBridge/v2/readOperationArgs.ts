/**
 * Purpose: ONE typed parse of an MCP wire payload, from the generated
 *   contract — replacing the per-field `typeof` chains each handler carried
 *   Every chain was a hand-written restatement of a contract that
 *   lives elsewhere, which is how `args.clientId` survived: a read for a field
 *   the contract never declared, that no sender could ever populate, sitting
 *   behind a fallback that was the only branch that ever ran.
 *
 * Coercion is deliberately the SAME as the chains it replaces: a declared
 * field whose runtime value is the wrong shape reads as absent, and the
 * handler's own guard decides what that means. This is a de-duplication, not
 * a tightening — a stricter payload gate belongs with a protocol change.
 * `readOperationArgsChecked` also names those fields, for the handlers whose
 * guard must refuse them rather than treat them as absent (the browser
 * surface's tab id, timeouts, style operations, workflow inputs, every
 * field of a journaled write — `writeAddresses.ts`).
 *
 * Undeclared fields are LOGGED, never silently dropped (ledger D5): the app
 * side cannot refuse them without breaking version skew in the direction skew
 * actually happens (newer sidecar, older app), but a field arriving that
 * nothing declares is exactly the signal a dead branch is being fed.
 *
 * @coordinates-with generated/bridgeContracts.ts — the generated contract
 * @module services/mcpBridge/v2/readOperationArgs
 */
import { mcpContractWarn } from "@/utils/debug";
import {
  BRIDGE_OPERATION_FIELDS,
  type BridgeFieldKind,
  type BridgeOperationArgs,
} from "./generated/bridgeContracts";

/** Operations the webview can parse args for. */
export type ParsableOperation = keyof typeof BRIDGE_OPERATION_FIELDS &
  keyof BridgeOperationArgs;

function matchesKind(value: unknown, kind: BridgeFieldKind): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "unknown":
      return true;
  }
}

/** A payload read against its contract. */
export interface CheckedOperationArgs<Op extends ParsableOperation> {
  /** What `readOperationArgs` returns: the declared fields of the right kind. */
  wire: Partial<BridgeOperationArgs[Op]>;
  /** Declared fields that were present with the wrong kind — absent from `wire`. */
  malformed: ReadonlySet<string>;
}

/**
 * Narrow a raw wire payload to the fields its operation declares.
 *
 * Every returned field is optional: presence is the payload's business and
 * the handler's guard, not this function's. Values that fail their declared
 * kind are omitted rather than coerced.
 */
export function readOperationArgs<Op extends ParsableOperation>(
  operation: Op,
  args: Record<string, unknown>,
): Partial<BridgeOperationArgs[Op]> {
  return readOperationArgsChecked(operation, args).wire;
}

/**
 * `readOperationArgs`, plus the declared fields that arrived malformed — for
 * a handler whose promise to its client is stricter than "the wrong shape
 * reads as absent": one that must refuse a malformed tab id rather than act on
 * the focused tab, or a malformed timeout rather than wait the default.
 */
export function readOperationArgsChecked<Op extends ParsableOperation>(
  operation: Op,
  args: Record<string, unknown>,
): CheckedOperationArgs<Op> {
  const declared = BRIDGE_OPERATION_FIELDS[operation];
  const parsed: Record<string, unknown> = {};
  const malformed = new Set<string>();
  for (const field of declared) {
    const value = args[field.name];
    if (value === undefined) continue;
    if (matchesKind(value, field.kind)) parsed[field.name] = value;
    else malformed.add(field.name);
  }
  const known = new Set<string>(declared.map((field) => field.name));
  const undeclared = Object.keys(args).filter((name) => !known.has(name));
  if (undeclared.length > 0) {
    mcpContractWarn(
      `${operation} carried undeclared field(s) ${undeclared.sort().join(", ")} — ` +
        "ignored; the wire contract does not declare them",
    );
  }
  return { wire: parsed as Partial<BridgeOperationArgs[Op]>, malformed };
}
