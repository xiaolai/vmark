/**
 * Shared CLI argument parsing for the E2E harnesses.
 *
 * Purpose: one validated parser for the flags `e2e/smoke.mjs` and
 * `e2e/run-journeys.mjs` both accept (`--port`, `--host`, `--timeout`, plus
 * `--only` for the journey runner). Invalid, unknown, or incomplete flags
 * print a usage line and exit 2 instead of silently producing a NaN port or
 * an `undefined` host that would surface later as a confusing connection
 * failure.
 */

/**
 * Parse harness CLI flags. On any invalid input this prints the error plus
 * `usage` to stderr and exits the process with code 2 (these are CLI-only
 * entry points; there is no caller to recover).
 *
 * @param {string[]} argv        Arguments after the script path.
 * @param {{ allowOnly?: boolean, usage?: string }} [opts]
 * @returns {{ port: number, host: string, timeoutMs: number, only: string|null }}
 */
export function parseArgs(argv, { allowOnly = false, usage = "" } = {}) {
  const cfg = { port: 9323, host: "127.0.0.1", timeoutMs: 15000, only: null };

  const die = (msg) => {
    console.error(`Invalid arguments: ${msg}`);
    if (usage) console.error(usage);
    process.exit(2);
  };

  const takeValue = (flag, value) => {
    if (value === undefined || value.startsWith("--")) die(`${flag} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      cfg.port = Number(takeValue(a, argv[++i]));
      if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
        die("--port must be an integer between 1 and 65535");
      }
    } else if (a === "--host") {
      cfg.host = takeValue(a, argv[++i]);
    } else if (a === "--timeout") {
      cfg.timeoutMs = Number(takeValue(a, argv[++i]));
      if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs <= 0) {
        die("--timeout must be a positive number of milliseconds");
      }
    } else if (allowOnly && a === "--only") {
      cfg.only = takeValue(a, argv[++i]);
    } else {
      die(`unknown flag "${a}"`);
    }
  }
  return cfg;
}
