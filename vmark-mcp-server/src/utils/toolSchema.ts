/**
 * Derive JSON Schema FROM the authored Zod schema.
 *
 * Purpose: the pipeline used to run the other way — hand-written JSON Schema →
 * an in-house converter → Zod → the SDK converts back to JSON Schema. The
 * converter modelled only `type/description/enum/default/oneOf/items/
 * properties/required`; everything else was dropped without error, so
 * `browser.timeoutMs`'s declared `{minimum: 1, maximum: 12000}` never reached
 * the client-visible schema. Zod is now the single authored source and this
 * module is the one-way derivation for the few places that still want JSON
 * Schema (health checks, contract tests).
 *
 * @coordinates-with types.ts (ToolDefinition.inputSchema is a Zod raw shape)
 * @coordinates-with cli.ts (hands the raw shape straight to the SDK)
 */

import { z } from 'zod';
import type { ToolDefinition, ToolShape } from '../types.js';

/** JSON Schema object as MCP clients see it. */
export interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Convert a Zod raw shape to JSON Schema.
 *
 * `io: 'input'` is what a client sends, so a property with a `.default()` is
 * advertised as optional AND carries its machine-readable default.
 */
function shapeToJsonSchema(shape: ToolShape): JsonSchemaObject {
  return z.toJSONSchema(z.object(shape), { io: 'input' }) as unknown as JsonSchemaObject;
}

/** The input schema an MCP client sees for a tool. */
export function toolInputJsonSchema(tool: ToolDefinition): JsonSchemaObject {
  return shapeToJsonSchema(tool.inputSchema);
}

/** The output schema an MCP client sees for a tool, when it declares one. */
export function toolOutputJsonSchema(tool: ToolDefinition): JsonSchemaObject | undefined {
  return tool.outputSchema ? shapeToJsonSchema(tool.outputSchema) : undefined;
}
