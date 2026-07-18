/**
 * JSON Schema → Zod conversion for MCP tool registration.
 *
 * Purpose: The VMark tool definitions declare their input schemas as plain
 * JSON Schema; the MCP SDK's registerTool wants Zod. This converter preserves
 * the structure — including descriptions and machine-readable `default`
 * values — so clients see the schema the tool actually declared.
 *
 * @coordinates-with cli.ts (consumer during tool registration)
 */

import { z, ZodTypeAny } from 'zod';

/**
 * JSON Schema property definition.
 */
export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  // For oneOf (union types)
  oneOf?: JsonSchemaProperty[];
  // For arrays with typed items
  items?: JsonSchemaProperty;
  // For nested objects
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * JSON Schema input schema definition.
 */
export interface JsonSchemaInput {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * Convert a JSON Schema property to a Zod schema.
 * Handles: enum, oneOf, nested objects, arrays with typed items, integer vs
 * number, and declared `default` values.
 */
export function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): ZodTypeAny {
  let schema: ZodTypeAny;

  // Handle enum first (takes precedence)
  if (prop.enum && prop.enum.length > 0) {
    schema = z.enum(prop.enum as [string, ...string[]]);
  }
  // Handle oneOf (union type)
  else if (prop.oneOf && prop.oneOf.length > 0) {
    const variants = prop.oneOf.map((variant) => jsonSchemaPropertyToZod(variant as JsonSchemaProperty));
    if (variants.length === 1) {
      schema = variants[0];
    } else {
      schema = z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
    }
  }
  // Handle by type
  else {
    switch (prop.type) {
      case 'string':
        schema = z.string();
        break;
      case 'number':
        schema = z.number();
        break;
      case 'integer':
        schema = z.number().int();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        // Use typed items if available
        if (prop.items) {
          schema = z.array(jsonSchemaPropertyToZod(prop.items as JsonSchemaProperty));
        } else {
          schema = z.array(z.unknown());
        }
        break;
      case 'object':
        // Use nested properties if available
        if (prop.properties) {
          const shape: Record<string, ZodTypeAny> = {};
          const required = new Set(prop.required ?? []);
          for (const [key, subProp] of Object.entries(prop.properties)) {
            shape[key] = applyOptionality(
              jsonSchemaPropertyToZod(subProp),
              subProp,
              required.has(key),
            );
          }
          schema = z.object(shape);
        } else {
          schema = z.record(z.string(), z.unknown());
        }
        break;
      default:
        schema = z.unknown();
    }
  }

  // Add description if present
  if (prop.description) {
    schema = schema.describe(prop.description);
  }

  // Preserve the declared default so the advertised MCP tool schema keeps
  // its machine-readable default and omitted args parse to it.
  if (prop.default !== undefined) {
    schema = schema.default(prop.default);
  }

  return schema;
}

/**
 * Wrap a non-required property in `.optional()` — unless it carries a
 * default: `.default()` already accepts a missing value and substitutes it,
 * while an outer `.optional()` would short-circuit to `undefined` and never
 * apply the default.
 */
function applyOptionality(
  schema: ZodTypeAny,
  prop: JsonSchemaProperty,
  isRequired: boolean,
): ZodTypeAny {
  if (isRequired || prop.default !== undefined) {
    return schema;
  }
  return schema.optional();
}

/**
 * Convert a JSON Schema to a Zod object schema.
 * This preserves the schema structure so Claude can understand what parameters are expected.
 */
export function jsonSchemaToZod(inputSchema: JsonSchemaInput): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  const required = new Set(inputSchema.required ?? []);

  if (inputSchema.properties) {
    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      shape[key] = applyOptionality(
        jsonSchemaPropertyToZod(prop),
        prop,
        required.has(key),
      );
    }
  }

  return z.object(shape);
}
