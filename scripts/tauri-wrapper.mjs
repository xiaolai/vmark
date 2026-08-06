/**
 * Tauri CLI wrapper.
 *
 * Purpose: run the repo-local Tauri CLI with the dev config applied, and refuse
 * fast when the MCP sidecar binary is missing.
 *
 * Key decisions:
 *   - `dev` gets `--config src-tauri/tauri.dev.conf.json` automatically unless
 *     the caller supplied one, so `pnpm tauri dev` and `pnpm tauri:dev` behave
 *     identically. Detection follows clap's parsing: the subcommand is the
 *     first non-flag token (global flags may precede it), and a config flag
 *     counts in every spelling (`--config x`, `--config=x`, `-c x`, `-cx`).
 *     This matters because Tauri merges configs in ORDER — appending the dev
 *     config after an undetected user config silently overrode it.
 *   - A SIDECAR PREFLIGHT runs before `dev` and `build`. Tauri bundles the MCP
 *     sidecar as an external binary, and that binary is a gitignored build
 *     artifact — so a fresh clone or git worktree has an empty
 *     `src-tauri/binaries/`. Cargo only discovers this when the build script
 *     runs, at 644/649, minutes in, and reports
 *     `resource path 'binaries/vmark-mcp-server-aarch64-apple-darwin' doesn't exist`
 *     which names neither the sidecar nor the command that produces it. Two
 *     seconds and an exact command beats several minutes and a riddle.
 *   - The target triple is IMPORTED from `build-sidecar-core.mjs`, never
 *     restated. A second copy would drift from the builder that creates the
 *     file this checks for, and the preflight would then look for a name
 *     nothing produces.
 *   - The preflight FAILS OPEN on a host this repo has no target for. Its job
 *     is converting a known slow failure into a fast one, not adding a gate.
 *
 * @coordinates-with server/mcp/scripts/build-sidecar-core.mjs — TARGET_MAP
 * @module scripts/tauri-wrapper
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { TARGET_MAP } from "../server/mcp/scripts/build-sidecar-core.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

/** Sidecar filename Tauri expects for `targetKey`, or null if unsupported. */
export function expectedSidecarName(targetKey) {
  const target = TARGET_MAP[targetKey];
  if (!target) return null;
  return `vmark-mcp-server-${target.triple}${target.ext ?? ""}`;
}

/**
 * Whether the sidecar for `targetKey` is present.
 *
 * `exists` is injected so this is testable without touching the filesystem.
 */
export function checkSidecarPresent(targetKey, exists) {
  const name = expectedSidecarName(targetKey);
  if (name === null) return { ok: true }; // unsupported host — fail open
  if (exists(name)) return { ok: true };

  return {
    ok: false,
    message:
      `\nMissing MCP sidecar: src-tauri/binaries/${name}\n\n` +
      `Tauri bundles this as an external binary, and it is a gitignored build\n` +
      `artifact — so a fresh clone or git worktree does not have it. Without it\n` +
      `the Rust build fails minutes in, at the build-script step, with a message\n` +
      `that does not mention the sidecar.\n\n` +
      `Build it once:\n\n` +
      `  pnpm --dir server/mcp build:sidecar\n`,
  };
}

/** Reverse of TARGET_MAP: Tauri target triple -> platform-arch key. */
const TRIPLE_TO_TARGET_KEY = Object.fromEntries(
  Object.entries(TARGET_MAP).map(([key, target]) => [target.triple, key]),
);

/**
 * Parse the wrapper-relevant shape of a Tauri CLI invocation.
 *
 * Clap accepts global flags BEFORE the subcommand and four spellings of a
 * value flag (`--config x`, `--config=x`, `-c x`, `-cx`). Reading `args[0]`
 * and exact tokens missed all of them: `--verbose dev` skipped the preflight
 * and the dev config entirely, and an undetected `--config=...` had the dev
 * config appended AFTER it, silently overriding it.
 */
export function parseTauriArgs(args) {
  const subcommand = args.find((token) => !token.startsWith("-")) ?? null;
  const hasConfig = args.some(
    (token) =>
      token === "--config" ||
      token.startsWith("--config=") ||
      token === "-c" ||
      /^-c./.test(token),
  );

  let target = null;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--target" || token === "-t") {
      target = args[i + 1] ?? null;
    } else if (token.startsWith("--target=")) {
      target = token.slice("--target=".length);
    } else if (/^-t./.test(token)) {
      target = token.slice(2).replace(/^=/, "");
    }
  }

  return { subcommand, hasConfig, target };
}

/**
 * Decide and run one wrapper invocation. Everything effectful is injected —
 * `spawnFn(argv)` runs the CLI, `existsFn(name)` probes `src-tauri/binaries/`
 * — so every branch is testable. Returns `{ argv, exitCode, message? }`;
 * `argv` is null when the preflight refused and nothing was spawned.
 */
export function runTauri({ args, env, spawnFn, existsFn }) {
  const { subcommand, hasConfig, target } = parseTauriArgs(args);
  const isDev = subcommand === "dev";

  if (isDev || subcommand === "build") {
    // A cross-build bundles the REQUESTED target's sidecar, not the host's —
    // preflighting the host binary verified a file Tauri would never bundle.
    // A triple outside TARGET_MAP maps to no key and rides
    // checkSidecarPresent's fail-open path, like an unsupported host.
    const targetKey = target
      ? (TRIPLE_TO_TARGET_KEY[target] ?? `unmapped-triple:${target}`)
      : `${env.platform}-${env.arch}`;
    const check = checkSidecarPresent(targetKey, existsFn);
    if (!check.ok) return { argv: null, exitCode: 1, message: check.message };
  }

  const argv =
    isDev && !hasConfig ? [...args, "--config", "src-tauri/tauri.dev.conf.json"] : [...args];

  const result = spawnFn(argv);
  if (result.error) return { argv, exitCode: 1, message: result.error.message };
  return { argv, exitCode: typeof result.status === "number" ? result.status : 1 };
}

function main() {
  // Use platform-specific tauri CLI path from node_modules
  const isWindows = process.platform === "win32";
  const tauriBin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    isWindows ? "tauri.cmd" : "tauri"
  );

  const outcome = runTauri({
    args: process.argv.slice(2),
    env: { platform: process.platform, arch: process.arch },
    existsFn: (name) => existsSync(path.join(projectRoot, "src-tauri", "binaries", name)),
    spawnFn: (argv) => spawnSync(tauriBin, argv, { stdio: "inherit", shell: isWindows }),
  });
  if (outcome.message) console.error(outcome.message);
  process.exit(outcome.exitCode);
}

// Only run when executed directly, so the helpers above stay importable by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
