/**
 * Tauri CLI wrapper.
 *
 * Purpose: run the repo-local Tauri CLI with the dev config applied, and refuse
 * fast when the MCP sidecar binary is missing.
 *
 * Key decisions:
 *   - `dev` gets `--config src-tauri/tauri.dev.conf.json` automatically unless
 *     the caller supplied one, so `pnpm tauri dev` and `pnpm tauri:dev` behave
 *     identically.
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

function main() {
  const args = process.argv.slice(2);
  const isDev = args[0] === "dev";
  const needsSidecar = isDev || args[0] === "build";
  const hasConfig = args.includes("--config") || args.includes("-c");

  if (needsSidecar) {
    const check = checkSidecarPresent(`${process.platform}-${process.arch}`, (name) =>
      existsSync(path.join(projectRoot, "src-tauri", "binaries", name)),
    );
    if (!check.ok) {
      console.error(check.message);
      process.exit(1);
    }
  }

  // Use platform-specific tauri CLI path from node_modules
  const isWindows = process.platform === "win32";
  const tauriBin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    isWindows ? "tauri.cmd" : "tauri"
  );

  const tauriArgs = isDev && !hasConfig
    ? [...args, "--config", "src-tauri/tauri.dev.conf.json"]
    : args;

  const result = spawnSync(tauriBin, tauriArgs, { stdio: "inherit", shell: isWindows });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(typeof result.status === "number" ? result.status : 1);
}

// Only run when executed directly, so the helpers above stay importable by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
