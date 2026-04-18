/**
 * Debug internals — shared by log/warn/error loggers.
 *
 * Purpose: Production warn/error sink that forwards to tauri-plugin-log
 * (~/Library/Logs/app.vmark/ on macOS) while always keeping a console
 * fallback. Consumers should import named loggers from `@/utils/debug`
 * (the barrel); this module is the private plumbing.
 *
 * @coordinates-with @tauri-apps/plugin-log — production warn/error sink
 * @module utils/debug/internals
 */

export const isDev = import.meta.env.DEV;

// Production warn/error: forward to tauri-plugin-log for file persistence.
// Lazy-loaded to avoid blocking startup; always falls back to console.
let _tauriWarn: ((msg: string) => Promise<void>) | null = null;
let _tauriError: ((msg: string) => Promise<void>) | null = null;

/* v8 ignore start -- @preserve reason: production-only plugin loading */
if (!isDev) {
  import("@tauri-apps/plugin-log").then(({ warn, error }) => {
    _tauriWarn = warn;
    _tauriError = error;
  }).catch(() => {
    // Plugin not available (e.g., unit tests) — console fallback continues
  });
}
/* v8 ignore stop */

/** Serialize args preserving Error.stack and object structure. */
export function formatArgs(tag: string, args: unknown[]): string {
  const parts = [tag];
  for (const a of args) {
    if (a instanceof Error) {
      parts.push(a.stack ?? a.message);
    } else if (typeof a === "object" && a !== null) {
      try { parts.push(JSON.stringify(a)); } catch { parts.push(String(a)); }
    } else {
      parts.push(String(a));
    }
  }
  return parts.join(" ");
}

/** Warn logger that persists to file in production. Always outputs to console as fallback. */
export function prodWarn(tag: string, ...args: unknown[]) {
  /* v8 ignore next 5 -- @preserve reason: isDev is always true in Vitest */
  if (isDev) {
    console.warn(tag, ...args);
  } else {
    console.warn(tag, ...args);
    if (_tauriWarn) void _tauriWarn(formatArgs(tag, args)).catch((e) => { console.error("[Log] persist warn failed:", e); });
  }
}

/** Error logger that persists to file in production. Always outputs to console as fallback. */
export function prodError(tag: string, ...args: unknown[]) {
  /* v8 ignore next 5 -- @preserve reason: isDev is always true in Vitest */
  if (isDev) {
    console.error(tag, ...args);
  } else {
    console.error(tag, ...args);
    if (_tauriError) void _tauriError(formatArgs(tag, args)).catch((e) => { console.error("[Log] persist error failed:", e); });
  }
}
