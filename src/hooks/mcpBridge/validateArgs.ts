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
 * Require a string argument that must be one of an allowed set of values.
 * Returns the default if key is missing/null; throws if the value is not in the allowed list.
 */
export function requireEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  defaultValue?: T
): T {
  const val = args[key];
  if ((val === undefined || val === null) && defaultValue !== undefined) return defaultValue;
  if (typeof val !== "string") {
    throw new Error(`Missing or invalid '${key}' (expected one of: ${allowed.join(", ")}; got ${typeof val})`);
  }
  if (!(allowed as readonly string[]).includes(val)) {
    throw new Error(`Invalid '${key}': "${val}". Must be one of: ${allowed.join(", ")}`);
  }
  return val as T;
}

/**
 * Require an argument to be an array. Throws if missing or not an array.
 * Optionally validates each element with a validator function.
 */
export function requireArray<T>(
  args: Record<string, unknown>,
  key: string,
  elementValidator?: (el: unknown, index: number) => T
): T[] {
  const val = args[key];
  if (!Array.isArray(val)) {
    throw new Error(`Missing or invalid '${key}' (expected array, got ${typeof val})`);
  }
  if (elementValidator) {
    return val.map((el, i) => elementValidator(el, i));
  }
  return val as T[];
}
