/**
 * Minimal structured logger (grill H10).
 *
 * Emits single-line JSON to stderr so the (future) Rust supervisor can forward
 * it to `tauri-plugin-log`. Default in production is a real stderr logger; tests
 * inject `noopLogger` or a capturing fake.
 *
 * @module server/logger
 */

export interface Logger {
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function emit(level: string, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, msg, ...fields });
  process.stderr.write(`${line}\n`);
}

export const stderrLogger: Logger = {
  info: (msg, fields) => emit("info", msg, fields),
  warn: (msg, fields) => emit("warn", msg, fields),
  error: (msg, fields) => emit("error", msg, fields),
};
