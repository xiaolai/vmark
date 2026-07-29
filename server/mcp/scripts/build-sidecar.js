#!/usr/bin/env node
/**
 * Build script for VMark MCP Server sidecar binary — thin executable
 * wrapper. All behavior lives in build-sidecar-core.mjs (dependency-
 * injected, unit-tested); this file only binds real child_process/fs/os.
 *
 * 1. Bundles the TypeScript code with esbuild into a single CJS file
 * 2. Packages the bundle with pkg into standalone executables
 *
 * Output format: vmark-mcp-server-{target-triple}
 *   - vmark-mcp-server-aarch64-apple-darwin (M1/M2 Mac)
 *   - vmark-mcp-server-x86_64-apple-darwin (Intel Mac)
 *   - vmark-mcp-server-x86_64-pc-windows-msvc.exe (Windows)
 *   - vmark-mcp-server-x86_64-unknown-linux-gnu (Linux)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, access, rm, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:os';
import { runBuild, resolveBinScript } from './build-sidecar-core.mjs';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const require = createRequire(join(PROJECT_ROOT, 'package.json'));

/** Tool id (args[0] from the core) → [package name, bin name]. */
const TOOL_BINS = {
  esbuild: ['esbuild', 'esbuild'],
  '@yao-pkg/pkg': ['@yao-pkg/pkg', 'pkg'],
};

const binDeps = {
  resolvePkgJson: (pkgName) => require.resolve(`${pkgName}/package.json`),
  readJson: (path) => JSON.parse(readFileSync(path, 'utf8')),
};

runBuild(process.argv.slice(2), {
  // The tools run as `node <resolved bin script>` — no npx, no shell, no
  // Windows `.cmd` shim, no CMD-metacharacter hazards. Resolution goes
  // through the lockfile-installed local packages, so a missing dependency
  // fails loudly instead of implicitly installing whatever the registry
  // serves (the old `npx --no-install` guarantee, kept).
  runTool: (args) => {
    const [tool, ...rest] = args;
    const mapping = TOOL_BINS[tool];
    if (!mapping) return Promise.reject(new Error(`Unknown build tool: ${tool}`));
    const binScript = resolveBinScript(binDeps, mapping[0], mapping[1]);
    return execFileAsync(process.execPath, [binScript, ...rest], { cwd: PROJECT_ROOT });
  },
  mkdir,
  rm,
  rename,
  access,
  log: (...parts) => console.log(...parts),
  error: (...parts) => console.error(...parts),
  currentTargetKey: `${platform()}-${arch()}`,
  projectRoot: PROJECT_ROOT,
  bundleOutput: join(PROJECT_ROOT, 'dist', 'cli.bundle.cjs'),
  binariesDir: join(PROJECT_ROOT, '..', '..', 'src-tauri', 'binaries'),
  runId: String(process.pid),
}).catch((error) => {
  console.error('Build failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
