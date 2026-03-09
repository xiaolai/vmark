/**
 * MCP Bridge Argument Validation
 *
 * Purpose: Runtime validation helpers for MCP bridge handler arguments.
 *   Provides clear error messages at the boundary instead of opaque
 *   TypeErrors deep in business logic.
 *
 * @module hooks/mcpBridge/validateArgs
 */

/**
 * Require a string argument. Throws with a clear message if missing or wrong type.
 */
export function requireString(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  if (typeof val !== "string") {
    throw new Error(`Missing or invalid '${key}' (expected string, got ${typeof val})`);
  }
  return val;
}

/**
 * Require a number argument. Throws with a clear message if missing or wrong type.
 */
export function requireNumber(args: Record<string, unknown>, key: string): number {
  const val = args[key];
  if (typeof val !== "number") {
    throw new Error(`Missing or invalid '${key}' (expected number, got ${typeof val})`);
  }
  return val;
}

/**
 * Get an optional string argument. Returns undefined if not present.
 * Throws if present but wrong type.
 */
export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string") {
    throw new Error(`Invalid '${key}' (expected string, got ${typeof val})`);
  }
  return val;
}

/**
 * Get an optional number argument. Returns undefined if not present.
 * Throws if present but wrong type.
 */
export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "number") {
    throw new Error(`Invalid '${key}' (expected number, got ${typeof val})`);
  }
  return val;
}

/**
 * Get an optional boolean argument. Returns undefined if not present.
 * Throws if present but wrong type.
 */
export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "boolean") {
    throw new Error(`Invalid '${key}' (expected boolean, got ${typeof val})`);
  }
  return val;
}

/**
 * Number argument with a default fallback.
 */
export function numberWithDefault(args: Record<string, unknown>, key: string, defaultVal: number): number {
  const val = args[key];
  if (val === undefined || val === null) return defaultVal;
  if (typeof val !== "number") {
    throw new Error(`Invalid '${key}' (expected number, got ${typeof val})`);
  }
  return val;
}

/**
 * Boolean argument with a default fallback.
 */
export function booleanWithDefault(args: Record<string, unknown>, key: string, defaultVal: boolean): boolean {
  const val = args[key];
  if (val === undefined || val === null) return defaultVal;
  if (typeof val !== "boolean") {
    throw new Error(`Invalid '${key}' (expected boolean, got ${typeof val})`);
  }
  return val;
}

/**
 * Require a string argument with a default fallback.
 */
export function stringWithDefault(args: Record<string, unknown>, key: string, defaultVal: string): string {
  const val = args[key];
  if (val === undefined || val === null) return defaultVal;
  if (typeof val !== "string") {
    throw new Error(`Invalid '${key}' (expected string, got ${typeof val})`);
  }
  return val;
}

/**
 * Require a value from a fixed set of allowed strings, with optional default.
 * Validates at runtime that the value is one of the allowed options.
 */
export function requireEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  defaultValue?: T
): T {
  const raw = args[key];
  if ((raw === undefined || raw === null) && defaultValue !== undefined) return defaultValue;
  if (typeof raw !== "string") {
    throw new Error(`Missing or invalid '${key}' (expected string, got ${typeof raw})`);
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`Invalid ${key}: "${raw}". Must be one of: ${allowed.join(", ")}`);
  }
  return raw as T;
}
