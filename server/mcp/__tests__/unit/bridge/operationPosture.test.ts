// WI-15 — unknown-field posture, asserted per boundary class (ledger D5).
/**
 * Ledger `.claude/tdd-guardian/decisions-20260803.md` D5 rejects a single
 * global strip-vs-reject toggle: persistence reads need passthrough for
 * forward compatibility (WI-3), untrusted MCP tool input needs an explicit
 * posture per operation class, and where a field is load-bearing for ROUTING,
 * silent strip is forbidden — that silence is exactly how `args.windowId`
 * became a routing branch nothing could reach.
 *
 * So this pins the posture of every class, and — more importantly — pins the
 * REASON: each class that can select a target (window, workspace, tab) must
 * refuse an undeclared field rather than drop it. Real zod, never mocked.
 */
import { describe, it, expect } from 'vitest';
import {
  BRIDGE_OPERATION_SCHEMAS,
  OPERATION_CLASS_POSTURE,
  checkOutboundRequest,
  operationClass,
  operationNames,
  postureFor,
} from '../../../src/bridge/operationSchemas.js';

/** Fields that decide WHERE a request lands. An operation carrying one of
 *  these cannot be in a class that silently drops unknown keys. */
const TARGETING_FIELDS = ['tabId', 'windowLabel', 'filePath', 'folderPath', 'workspace_root'];

describe('unknown-field posture — per class, explicitly', () => {
  it('assigns exactly the classes the operation surface uses, with no default', () => {
    const classes = [...new Set(operationNames().map(operationClass))].sort();
    expect(classes).toEqual(Object.keys(OPERATION_CLASS_POSTURE).sort());
    expect(OPERATION_CLASS_POSTURE).toEqual({
      session: 'strip-and-log',
      workspace: 'reject',
      document: 'reject',
      workflow: 'reject',
      selection: 'reject',
      browser: 'reject',
      coherence: 'reject',
    });
  });

  it('rejects — never strips — on every class that can select a target', () => {
    for (const operation of operationNames()) {
      const fields = Object.keys(
        BRIDGE_OPERATION_SCHEMAS[operation as keyof typeof BRIDGE_OPERATION_SCHEMAS].shape
      );
      if (!fields.some((field) => TARGETING_FIELDS.includes(field))) continue;
      expect(postureFor(operation), `${operation} routes on a target field`).toBe('reject');
    }
  });

  it('refuses an undeclared field on a rejecting operation, naming it', () => {
    const check = checkOutboundRequest({
      type: 'vmark.workspace.open',
      filePath: '/w/a.md',
      windowId: 'doc-2',
    } as never);
    expect(check.error).toContain('windowId');
    expect(check.error).toContain('vmark.workspace.open');
    expect(check.warning).toBeNull();
  });

  it('would have refused the payload the dead windowId branch was waiting for', () => {
    // `routing.rs` read `args.windowId` for a year. No tool could ever send it,
    // and if one had, it would now be a loud refusal instead of a silent drop.
    for (const operation of operationNames()) {
      if (postureFor(operation) !== 'reject') continue;
      const check = checkOutboundRequest({ type: operation, windowId: 'doc-2' } as never);
      expect(check.error, `${operation} accepted an undeclared windowId`).toContain('windowId');
    }
  });

  it('forwards but LOUDLY reports an undeclared field on the version-skew class', () => {
    const check = checkOutboundRequest({
      type: 'vmark.session.get_state',
      clientProtocol: '0.3.0',
      clientFeatures: ['browser'],
    } as never);
    expect(check.error).toBeNull();
    expect(check.warning).toContain('clientFeatures');
    expect(check.warning).toContain('vmark.session.get_state');
  });

  it('still refuses a WRONG-TYPED declared field on the tolerant class', () => {
    const check = checkOutboundRequest({
      type: 'vmark.session.get_state',
      clientProtocol: 3,
    } as never);
    expect(check.error).toContain('clientProtocol');
    expect(check.warning).toBeNull();
  });

  it('passes an in-contract payload with neither error nor warning', () => {
    expect(
      checkOutboundRequest({
        type: 'vmark.document.write',
        tabId: 't1',
        content: '# x',
        expected_revision: 'r1',
        save: false,
      } as never)
    ).toEqual({ error: null, warning: null });
  });

  it('refuses an operation the contract does not know at all', () => {
    expect(checkOutboundRequest({ type: 'vmark.document.delete' } as never).error).toContain(
      'unknown bridge operation'
    );
  });

  it('has no class outside the declared union', () => {
    expect(() => operationClass('vmark.telemetry.send')).toThrow(/no known class/);
  });
});
