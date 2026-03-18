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
 * Require a plain object argument. Throws with a clear message if missing,
 * wrong type, or missing required keys. Arrays are rejected (not plain objects).
 */
export function requireObject<T = Record<string, unknown>>(
  args: Record<string, unknown>,
  key: string,
  requiredKeys?: string[]
): T {
  const val = args[key];
  if (val === null) {
    throw new Error(`Missing or invalid '${key}' (expected object, got null)`);
  }
  if (val === undefined || typeof val !== "object") {
    throw new Error(`Missing or invalid '${key}' (expected object, got ${typeof val})`);
  }
  if (Array.isArray(val)) {
    throw new Error(`Missing or invalid '${key}' (expected object, got array)`);
  }
  if (requiredKeys) {
    for (const k of requiredKeys) {
      if (!(k in (val as Record<string, unknown>))) {
        throw new Error(`Missing required field '${key}.${k}'`);
      }
    }
  }
  return val as T;
}

/**
 * Get an optional plain object argument. Returns undefined if not present.
 * Throws if present but wrong type. Arrays are rejected.
 */
export function optionalObject<T = Record<string, unknown>>(
  args: Record<string, unknown>,
  key: string
): T | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "object") {
    throw new Error(`Invalid '${key}' (expected object, got ${typeof val})`);
  }
  if (Array.isArray(val)) {
    throw new Error(`Invalid '${key}' (expected object, got array)`);
  }
  return val as T;
}

/**
 * Require an array argument. Throws with a clear message if missing or wrong type.
 */
export function requireArray(
  args: Record<string, unknown>,
  key: string
): unknown[] {
  const val = args[key];
  if (val === null) {
    throw new Error(`Missing or invalid '${key}' (expected array, got null)`);
  }
  if (!Array.isArray(val)) {
    throw new Error(`Missing or invalid '${key}' (expected array, got ${typeof val})`);
  }
  return val;
}

/**
 * Get an optional array argument. Returns undefined if not present.
 * Throws if present but wrong type.
 */
export function optionalArray(
  args: Record<string, unknown>,
  key: string
): unknown[] | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (!Array.isArray(val)) {
    throw new Error(`Invalid '${key}' (expected array, got ${typeof val})`);
  }
  return val;
}

/**
 * Require an array argument and validate each element with a custom validator.
 * Throws with a clear, indexed error message if any element fails validation.
 */
export function requireTypedArray<T>(
  args: Record<string, unknown>,
  key: string,
  validate: (item: unknown, index: number) => T
): T[] {
  const arr = requireArray(args, key);
  return arr.map((item, i) => validate(item, i));
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
