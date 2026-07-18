/**
 * Tests for the JSON Schema → Zod converter used by the cli to register
 * MCP tool input schemas.
 *
 * Codex finding 8: declared `default` values were dropped during conversion,
 * so the MCP tool schemas advertised to clients lost their machine-readable
 * defaults (e.g. document.save default:true).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod } from '../../../src/utils/jsonSchemaToZod.js';
import type { JsonSchemaInput } from '../../../src/utils/jsonSchemaToZod.js';
import { createVMarkMcpServer } from '../../../src/index.js';
import { MockBridge } from '../../mocks/mockBridge.js';

describe('jsonSchemaToZod', () => {
  const schemaWithDefault: JsonSchemaInput = {
    type: 'object',
    properties: {
      save: { type: 'boolean', description: 'persist to disk', default: true },
      name: { type: 'string' },
    },
    required: [],
  };

  it('applies a declared default when the property is omitted', () => {
    const schema = jsonSchemaToZod(schemaWithDefault);
    expect(schema.parse({})).toEqual({ save: true });
  });

  it('keeps an explicitly provided value over the default', () => {
    const schema = jsonSchemaToZod(schemaWithDefault);
    expect(schema.parse({ save: false })).toEqual({ save: false });
  });

  it('leaves properties without defaults optional', () => {
    const schema = jsonSchemaToZod(schemaWithDefault);
    const parsed = schema.parse({ name: 'x' });
    expect(parsed.name).toBe('x');
  });

  it('advertises machine-readable defaults in the generated JSON schema', () => {
    const schema = jsonSchemaToZod(schemaWithDefault);
    const json = z.toJSONSchema(schema, { io: 'input' }) as {
      properties: Record<string, { default?: unknown; description?: string }>;
    };
    expect(json.properties.save.default).toBe(true);
    expect(json.properties.save.description).toBe('persist to disk');
  });

  it('applies defaults inside nested object properties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        options: {
          type: 'object',
          properties: {
            depth: { type: 'integer', default: 2 },
          },
        },
      },
    });
    expect(schema.parse({ options: {} })).toEqual({ options: { depth: 2 } });
  });

  it('preserves the document tool save default end to end', () => {
    // The real schema that regressed: document.save declares default:true.
    const server = createVMarkMcpServer(new MockBridge());
    const documentTool = server.listTools().find((t) => t.name === 'document');
    expect(documentTool).toBeDefined();

    const schema = jsonSchemaToZod(documentTool!.inputSchema as JsonSchemaInput);
    const json = z.toJSONSchema(schema, { io: 'input' }) as {
      properties: Record<string, { default?: unknown }>;
    };
    expect(json.properties.save.default).toBe(true);

    // And behaviorally: omitting save on a write yields save: true.
    const parsed = schema.parse({ action: 'write', content: 'x' });
    expect(parsed.save).toBe(true);
  });

  it('converts enum, union, array, and unknown-type properties (regression safety)', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'write'] },
        target: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
        items: { type: 'array', items: { type: 'string' } },
        anything: {},
      },
      required: ['action'],
    });

    expect(schema.parse({ action: 'read' }).action).toBe('read');
    expect(schema.parse({ action: 'write', target: 5 }).target).toBe(5);
    expect(schema.parse({ action: 'read', items: ['a'] }).items).toEqual(['a']);
    expect(() => schema.parse({ action: 'delete' })).toThrow();
  });
});
