/**
 * The client-visible tool contract (WI-10.1, WI-10.4).
 *
 * Two defects this locks down:
 *
 * 1. ZERO of the seven tools declared `annotations` or `title`, so no client
 *    could tell `session` (pure read) from `browser` (drives a live page and
 *    runs scripts) without parsing prose.
 * 2. Schemas were authored as hand-written JSON Schema, converted to Zod by a
 *    lossy in-house converter, and converted BACK to JSON Schema by the SDK.
 *    Everything the converter did not model was dropped silently — live loss:
 *    `browser.timeoutMs` declared {minimum:1, maximum:12000} and the
 *    client-visible schema had neither bound. Schemas are now authored in Zod
 *    directly, so what the tool declares is what the client sees.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createVMarkMcpServer, EXPECTED_TOOL_COUNT } from '../../../src/index.js';
import { toolInputJsonSchema, toolOutputJsonSchema } from '../../../src/utils/toolSchema.js';
import type { ToolAnnotations, ToolDefinition } from '../../../src/types.js';
import { MockBridge } from '../../mocks/mockBridge.js';

function tools(): ToolDefinition[] {
  return createVMarkMcpServer(new MockBridge()).listTools();
}

function tool(name: string): ToolDefinition {
  const found = tools().find((t) => t.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

describe('tool annotations and titles', () => {
  it('registers exactly the declared tool surface', () => {
    expect(tools().map((t) => t.name).sort()).toEqual([
      'browser',
      'browser_read',
      'coherence',
      'coherence_resolve',
      'document',
      'selection',
      'session',
      'workflow',
      'workspace',
    ]);
    expect(tools()).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it('gives every tool a human-readable title and complete annotations', () => {
    for (const t of tools()) {
      expect(t.title, t.name).toBeTruthy();
      const a = t.annotations;
      expect(a, t.name).toBeDefined();
      expect(typeof a?.readOnlyHint, t.name).toBe('boolean');
      expect(typeof a?.idempotentHint, t.name).toBe('boolean');
      expect(typeof a?.openWorldHint, t.name).toBe('boolean');
      // destructiveHint is only meaningful when the tool is not read-only.
      if (a?.readOnlyHint === false) {
        expect(typeof a?.destructiveHint, t.name).toBe('boolean');
      }
    }
  });

  it('marks session read-only, idempotent, and closed-world', () => {
    const expected: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
    expect(tool('session').annotations).toEqual(expected);
  });

  it('claims read-only for every tool whose every action is a pure read', () => {
    // The point of the browser/coherence split: a tool that only reads gets to
    // SAY so, which is what lets a client auto-approve it. Before the split
    // these actions were bundled with mutating siblings, so the composite had
    // to declare the dangerous value and an agent's every page read needed a
    // human. `browser_read` stays open-world — it reads the live web.
    for (const name of ['session', 'coherence', 'browser_read']) {
      expect(tool(name).annotations?.readOnlyHint, name).toBe(true);
      expect(tool(name).annotations?.destructiveHint, name).toBe(false);
      expect(tool(name).annotations?.idempotentHint, name).toBe(true);
    }
  });

  it('never claims read-only for a tool that can mutate', () => {
    // A composite tool cannot be both readOnlyHint:true and destructiveHint:true.
    // Each of these carries at least one mutating action, so the honest
    // annotation is the DANGEROUS one, even where most actions only read.
    for (const name of [
      'document', 'selection', 'workspace', 'workflow', 'browser', 'coherence_resolve',
    ]) {
      expect(tool(name).annotations?.readOnlyHint, name).toBe(false);
      expect(tool(name).annotations?.destructiveHint, name).toBe(true);
    }
  });

  it('marks the tools that reach outside VMark as open-world', () => {
    // browser drives arbitrary web pages (and browser_read reads them);
    // workspace opens arbitrary local paths.
    for (const name of ['browser', 'browser_read', 'workspace']) {
      expect(tool(name).annotations?.openWorldHint, name).toBe(true);
    }
    // The rest operate only on buffers VMark already owns.
    for (const name of [
      'session', 'document', 'selection', 'workflow', 'coherence', 'coherence_resolve',
    ]) {
      expect(tool(name).annotations?.openWorldHint, name).toBe(false);
    }
  });
});

describe('client-visible input schemas', () => {
  it('carries browser.timeoutMs integer bounds through to the client', () => {
    const schema = toolInputJsonSchema(tool('browser')) as {
      properties: Record<string, { type?: string; minimum?: number; maximum?: number }>;
    };
    expect(schema.properties.timeoutMs).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 12000,
    });
  });

  it('carries the document.save default through to the client', () => {
    const schema = toolInputJsonSchema(tool('document')) as {
      properties: Record<string, { default?: unknown; description?: string }>;
    };
    expect(schema.properties.save.default).toBe(true);
    expect(schema.properties.save.description).toBeTruthy();
  });

  it('marks `action` required on every tool and workspace_root on coherence', () => {
    for (const t of tools()) {
      const schema = toolInputJsonSchema(t) as { required?: string[] };
      expect(schema.required, t.name).toContain('action');
    }
    for (const name of ['coherence', 'coherence_resolve']) {
      const schema = toolInputJsonSchema(tool(name)) as { required?: string[] };
      expect(schema.required, name).toContain('workspace_root');
    }
  });

  it('advertises each tool action enum verbatim (no surface drift)', () => {
    const actions = (name: string) => {
      const schema = toolInputJsonSchema(tool(name)) as {
        properties: Record<string, { enum?: string[] }>;
      };
      return schema.properties.action.enum;
    };
    expect(actions('session')).toEqual(['get_state']);
    expect(actions('document')).toEqual(['read', 'write', 'transform']);
    expect(actions('selection')).toEqual(['get', 'set']);
    expect(actions('workflow')).toEqual(['apply_patch', 'validate']);
    expect(actions('coherence')).toEqual(['status', 'edges', 'claims', 'contexts']);
    expect(actions('coherence_resolve')).toEqual(['resolve']);
    expect(actions('workspace')).toEqual([
      'new', 'open', 'open_workspace', 'save', 'save_as', 'close', 'switch_tab', 'focus_window',
    ]);
    // The split runs along one line: does the action modify anything?
    expect(actions('browser_read')).toEqual([
      'read', 'screenshot', 'query', 'console', 'wait', 'wait_for',
    ]);
    expect(actions('browser')).toEqual([
      'act', 'open', 'navigate', 'style', 'execute_js',
      'session_save', 'session_load', 'console_clear',
    ]);
  });

  it('keeps the console DRAIN out of the read-only tool', () => {
    // `console` with clear:true evaluates `e.textContent = "[]"` in the page —
    // it writes to the DOM. Leaving that under readOnlyHint:true would put a
    // false claim back into the surface the split exists to make honest, so
    // draining is a separate action on the mutating tool.
    const read = toolInputJsonSchema(tool('browser_read')) as {
      properties: Record<string, unknown>;
    };
    expect(read.properties.clear).toBeUndefined();
  });

  it('rejects an out-of-range timeoutMs at the schema layer, not only in the handler', () => {
    // The whole point of carrying the bound: the SDK validates input against
    // this schema before the handler ever runs.
    const shape = tool('browser').inputSchema;
    const parsed = z.object(shape).safeParse({ action: 'open', url: 'https://x', timeoutMs: 99999 });
    expect(parsed.success).toBe(false);
  });
});

describe('declared output schemas', () => {
  it('declares document.write and session.get_state response fields', () => {
    // Asserted through the client-visible derivation, not the raw Zod shape:
    // what matters is what an MCP client is told.
    const doc = toolOutputJsonSchema(tool('document'));
    expect(doc).toBeDefined();
    expect(Object.keys(doc!.properties ?? {})).toEqual(
      expect.arrayContaining(['saved', 'save_skipped', 'save_error', 'current_revision']),
    );
    // Every field optional: one schema has to fit read, write, AND transform.
    expect(doc!.required ?? []).toEqual([]);

    const session = toolOutputJsonSchema(tool('session'));
    expect(session).toBeDefined();
    expect(Object.keys(session!.properties ?? {})).toEqual(
      expect.arrayContaining(['windows', 'capabilities']),
    );
  });

  it('declares selection.{get,set} response fields', () => {
    // Added after `document`: `selection.set` is refused as STALE the same way
    // `document.write` is, and without a declared schema the client was never
    // told `current_revision` exists. Its payloads are as small and as stable
    // as document's, so it earns the same treatment.
    const sel = toolOutputJsonSchema(tool('selection'));
    expect(sel).toBeDefined();
    expect(Object.keys(sel!.properties ?? {})).toEqual(
      expect.arrayContaining(['text', 'range', 'revision', 'replaced_chars', 'current_revision']),
    );
    // Every field optional: one schema has to fit get AND set.
    expect(sel!.required ?? []).toEqual([]);
  });

  it('declares no output schema for tools whose response shape is not stable', () => {
    // `workspace` and `coherence` each answer 5-8 structurally unrelated
    // actions; `workflow.apply_patch` and `browser` return app-versioned
    // payloads. For those, a schema that failed to anticipate a payload would
    // report a completed mutation as a protocol error — a worse failure than
    // an undeclared shape.
    for (const name of [
      'workspace', 'workflow', 'browser', 'browser_read', 'coherence', 'coherence_resolve',
    ]) {
      expect(toolOutputJsonSchema(tool(name)), name).toBeUndefined();
    }
  });

  it('keeps output schemas permissive enough for every action of a composite tool', () => {
    // `document` answers read / write / transform through ONE schema. If the
    // schema rejected any real payload, the SDK would turn a successful tool
    // call into an Output validation error.
    const schema = z.object(tool('document').outputSchema!);
    expect(schema.safeParse({ content: '# hi', revision: 'r1', filePath: null, kind: 'markdown', dirty: false }).success).toBe(true);
    expect(schema.safeParse({ revision: 'r2', saved: true }).success).toBe(true);
    expect(schema.safeParse({ revision: 'r3', saved: false, save_skipped: 'untitled' }).success).toBe(true);
    expect(schema.safeParse({ revision: 'r4', saved: false, save_error: 'EROFS' }).success).toBe(true);
    expect(schema.safeParse({ truncated: true, truncation_note: 'too big' }).success).toBe(true);
  });
});

describe('round-2 audit: schema-layer guards', () => {
  it('advertises every optional tabId as non-blank (finding 4)', () => {
    // The SDK validates input against this schema before the handler runs, so
    // the blank-id refusal has to live here as well as in the handler.
    for (const name of [
      'document', 'selection', 'workflow', 'workspace', 'browser', 'browser_read',
    ]) {
      const schema = toolInputJsonSchema(tool(name)) as {
        properties: Record<string, { minLength?: number }>;
      };
      expect(schema.properties.tabId?.minLength, name).toBe(1);

      const shape = z.object(tool(name).inputSchema);
      const action = (toolInputJsonSchema(tool(name)) as {
        properties: Record<string, { enum?: string[] }>;
      }).properties.action.enum![0];
      expect(shape.safeParse({ action, tabId: '' }).success, name).toBe(false);
      expect(shape.safeParse({ action, tabId: '   ' }).success, name).toBe(false);
    }
  });

  it('enforces the browser payload cap in BYTES at the schema layer (finding 5)', () => {
    const shape = z.object(tool('browser').inputSchema);
    const cjk = '汉'.repeat(30_000); // 30k UTF-16 units, 90k UTF-8 bytes

    expect(shape.safeParse({ action: 'execute_js', script: cjk }).success).toBe(false);
    expect(shape.safeParse({ action: 'style', injectCss: cjk }).success).toBe(false);
    expect(shape.safeParse({ action: 'execute_js', script: '汉'.repeat(1_000) }).success).toBe(true);
  });

  it('declares the truncation envelope on every tool that has an output schema', () => {
    for (const name of ['document', 'session']) {
      const schema = toolOutputJsonSchema(tool(name))!;
      expect(Object.keys(schema.properties ?? {}), name).toEqual(
        expect.arrayContaining([
          'truncated',
          'truncation_note',
          'bytes_total',
          'bytes_shown',
          'preview',
        ]),
      );
    }
  });

  it('accepts a truncation envelope and a STALE envelope against document output', () => {
    // Both are real responses of the tool; a schema that rejected either would
    // turn a live call into an SDK output-validation error.
    const schema = z.object(tool('document').outputSchema!);
    expect(
      schema.safeParse({
        truncated: true,
        truncation_note: 'too big',
        bytes_total: 90_000,
        bytes_shown: 74_000,
        preview: '# hi',
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ error: 'STALE', message: 'changed', current_revision: 'r9' }).success,
    ).toBe(true);
  });
});

describe('round-2 audit: browser.open profile (finding 6)', () => {
  it('rejects a malformed profile at the schema layer and normalizes a valid one', () => {
    const shape = z.object(tool('browser').inputSchema);
    const open = { action: 'open', url: 'https://x.com' };

    expect(shape.safeParse({ ...open, profile: 'has space' }).success).toBe(false);
    expect(shape.safeParse({ ...open, profile: 'bad/slash' }).success).toBe(false);
    expect(shape.safeParse({ ...open, profile: '' }).success).toBe(false);
    // Trimmed by the schema exactly as the handler trims it — the two layers
    // must not disagree about what a profile is.
    const ok = shape.safeParse({ ...open, profile: ' work-1 ' });
    expect(ok.success && ok.data.profile).toBe('work-1');
  });
});
