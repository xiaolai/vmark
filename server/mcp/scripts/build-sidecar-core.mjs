/**
 * Build core for the VMark MCP Server sidecar (WI-5, audit-followups
 * 20260729). All logic lives here with injected exec/fs/log dependencies so
 * target resolution, stale-artifact replacement, sequential failure
 * aggregation, and cleanup are unit-testable without invoking real
 * esbuild/pkg. build-sidecar.js is the thin executable wrapper.
 *
 * @coordinates-with build-sidecar.js — binds real child_process/fs deps
 */

import { join, dirname } from 'node:path';

/** Single source of truth for the embedded Node runtime major version. */
export const NODE_RUNTIME = 'node22';

/**
 * Map platform/arch to Tauri target triple and pkg target.
 */
export const TARGET_MAP = {
  'darwin-arm64': {
    triple: 'aarch64-apple-darwin',
    pkg: `${NODE_RUNTIME}-macos-arm64`,
  },
  'darwin-x64': {
    triple: 'x86_64-apple-darwin',
    pkg: `${NODE_RUNTIME}-macos-x64`,
  },
  'win32-x64': {
    triple: 'x86_64-pc-windows-msvc',
    pkg: `${NODE_RUNTIME}-win-x64`,
    ext: '.exe',
  },
  'linux-x64': {
    triple: 'x86_64-unknown-linux-gnu',
    pkg: `${NODE_RUNTIME}-linux-x64`,
  },
  'linux-arm64': {
    triple: 'aarch64-unknown-linux-gnu',
    pkg: `${NODE_RUNTIME}-linux-arm64`,
  },
};

/**
 * Sequential, index-consuming flag parser. Value-based "consumed sets" let
 * stray positionals ride along (`--target linux-x64 linux-x64` passed when
 * the value happened to match); consuming by index rejects every unexpected
 * token.
 */
function parseBuildFlags(args) {
  const seen = new Set();
  const flags = { buildAll: false, buildMacosUniversal: false, specificTarget: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--all' || a === '--macos-universal' || a === '--target') {
      // Duplicate flags are as suspicious as unknown ones in a release script.
      if (seen.has(a)) throw new Error(`Duplicate argument: ${a}`);
      seen.add(a);
    }
    if (a === '--all') {
      flags.buildAll = true;
    } else if (a === '--macos-universal') {
      flags.buildMacosUniversal = true;
    } else if (a === '--target') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--target requires a value (e.g. --target darwin-arm64)');
      }
      if (!Object.hasOwn(TARGET_MAP, value)) {
        throw new Error(
          `Unknown target: ${value}. Supported targets: ${Object.keys(TARGET_MAP).join(', ')}`
        );
      }
      flags.specificTarget = value;
      i++; // value consumed by index
    } else {
      // A mistyped flag must never silently fall back to a host build.
      throw new Error(`Unknown argument(s): ${a}`);
    }
  }
  const modes = [flags.buildAll, flags.buildMacosUniversal, flags.specificTarget !== null];
  if (modes.filter(Boolean).length > 1) {
    throw new Error('Use only one of --all, --macos-universal, or --target <target>');
  }
  return flags;
}

/** Pick the target list for the parsed mode (validation already done). */
function selectTargets(flags, currentTargetKey, log) {
  if (flags.specificTarget) {
    log(`Building for specific target: ${flags.specificTarget}\n`);
    return [flags.specificTarget];
  }
  if (flags.buildMacosUniversal) {
    // Build both macOS architectures separately
    // NOTE: Do NOT use lipo to combine pkg binaries - it corrupts the embedded JS!
    // Tauri will bundle both arch-specific binaries and select the correct one at runtime.
    log('Building for macOS universal (arm64 + x64)...\n');
    log('NOTE: pkg binaries cannot be combined with lipo. Keeping both arch-specific binaries.\n');
    return ['darwin-arm64', 'darwin-x64'];
  }
  if (flags.buildAll) {
    log('Building for all platforms...\n');
    return Object.keys(TARGET_MAP);
  }
  log(`Building for current platform: ${currentTargetKey}\n`);
  if (!TARGET_MAP[currentTargetKey]) {
    throw new Error(
      `Unsupported platform: ${currentTargetKey}. Supported platforms: ${Object.keys(TARGET_MAP).join(', ')}`
    );
  }
  return [currentTargetKey];
}

/**
 * Resolve CLI arguments to the list of targets to build.
 * Throws on malformed, unknown, or duplicate values. `currentTargetKey` is
 * injected so tests cover every platform branch.
 */
export function resolveTargets(args, currentTargetKey, log = () => {}) {
  return selectTargets(parseBuildFlags(args), currentTargetKey, log);
}

/**
 * Resolve a package's bin script to an absolute path — the file `node` runs
 * directly. Bypassing npx removes the Windows `.cmd`-shim/shell problem (and
 * every CMD-metacharacter hazard) entirely: `node <script.js>` is exact-arg
 * safe on every platform. Deps are injected for testability:
 * { resolvePkgJson(pkgName) -> path, readJson(path) -> object }.
 */
export function resolveBinScript(deps, pkgName, binName) {
  const pkgJsonPath = deps.resolvePkgJson(pkgName);
  const pkg = deps.readJson(pkgJsonPath);
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
  if (!bin) {
    throw new Error(`Package ${pkgName} does not declare a "${binName}" bin`);
  }
  return join(dirname(pkgJsonPath), bin);
}

/** Drop esbuild's normal completion line; keep warnings that may precede it. */
export function meaningfulStderr(stderr) {
  return stderr
    .split('\n')
    .filter((line) => !/^\s*Done in \d|^\s*⚡?\s*Done/.test(line) && line.trim() !== '')
    .join('\n');
}

/**
 * Bundle the code with esbuild into a single CJS file.
 * deps: { runTool, access, log, error, projectRoot, bundleOutput }
 */
export async function bundleWithEsbuild(deps) {
  deps.log('Bundling with esbuild...');

  const esbuildArgs = [
    'esbuild',
    join(deps.projectRoot, 'src', 'cli.ts'),
    '--bundle',
    '--platform=node',
    `--target=${NODE_RUNTIME}`,
    '--format=cjs',
    `--outfile=${deps.bundleOutput}`,
    '--external:fsevents', // Optional macOS dependency
  ];

  deps.log(`Running: ${esbuildArgs.join(' ')}`);
  const { stdout, stderr } = await deps.runTool(esbuildArgs);

  if (stdout) deps.log(stdout);
  if (stderr) {
    const meaningful = meaningfulStderr(stderr);
    if (meaningful) deps.error(meaningful);
  }

  // Verify bundle exists
  await deps.access(deps.bundleOutput);
  deps.log(`Bundle created: ${deps.bundleOutput}\n`);
}

/** Run pkg for one target, packaging the bundle to `stagingPath`. */
async function runPkg(deps, target, stagingPath) {
  const pkgArgs = [
    '@yao-pkg/pkg',
    deps.bundleOutput,
    '--target', target.pkg,
    '--output', stagingPath,
    '--compress', 'GZip',
  ];
  deps.log(`Running: ${pkgArgs.join(' ')}`);
  const { stdout, stderr } = await deps.runTool(pkgArgs);
  if (stdout) deps.log(stdout);
  if (stderr) deps.error(stderr);
}

/**
 * Build sidecar for a specific target. Packages to a per-run staging path,
 * verifies, then renames over the destination: deleting the old artifact
 * first would leave the target with NO usable binary when a build fails, and
 * the per-run suffix (deps.runId) keeps concurrent invocations from
 * clobbering each other's staging file.
 * deps: { runTool, mkdir, rm, rename, access, log, error, binariesDir, bundleOutput, runId? }
 */
export async function buildForTarget(targetKey, deps) {
  const target = TARGET_MAP[targetKey];
  if (!target) {
    deps.error(`Unknown target: ${targetKey}`);
    return false;
  }

  const ext = target.ext || '';
  const outputName = `vmark-mcp-server-${target.triple}${ext}`;
  const outputPath = join(deps.binariesDir, outputName);
  // The staging suffix goes BEFORE the extension: pkg normalizes Windows
  // output to end in `.exe`, so `foo.exe.staging-N` would be written as
  // `foo.exe.staging-N.exe` and the verify/rename step would miss it
  // (v0.9.19 release failure, windows-latest).
  const stagingPath = join(
    deps.binariesDir,
    `vmark-mcp-server-${target.triple}.staging-${deps.runId ?? 'local'}${ext}`
  );

  deps.log(`Building for ${targetKey} -> ${outputName}`);

  try {
    await deps.mkdir(deps.binariesDir, { recursive: true });
    await deps.rm(stagingPath, { force: true });
    await runPkg(deps, target, stagingPath);
    await deps.access(stagingPath);
    await deps.rename(stagingPath, outputPath);
    deps.log(`Successfully built: ${outputPath}`);
    return true;
  } catch (error) {
    deps.error(
      `Failed to build for ${targetKey}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Don't leave a partial staging binary behind on failure.
    try {
      await deps.rm(stagingPath, { force: true });
    } catch {
      /* best-effort */
    }
    return false;
  }
}

/**
 * Full build run: resolve targets, bundle once, package each target
 * SEQUENTIALLY (pkg invocations share npm/pkg caches — parallel builds race),
 * clean the bundle up on every path, and throw when any target failed so the
 * wrapper exits nonzero. A failed cleanup on an otherwise-successful run also
 * throws — exiting zero while leaving a stray bundle is a silent lie.
 */
export async function runBuild(argv, deps) {
  const targets = resolveTargets(argv, deps.currentTargetKey, deps.log);

  deps.log('VMark MCP Server Sidecar Builder');
  deps.log('================================\n');

  let bodyFailed = false;
  try {
    await bundleWithEsbuild(deps);

    const failed = [];
    for (const target of targets) {
      const success = await buildForTarget(target, deps);
      if (!success) failed.push(target);
    }

    deps.log(`\nBuilt ${targets.length - failed.length}/${targets.length} targets`);
    if (failed.length > 0) {
      throw new Error(`Failed targets: ${failed.join(', ')}`);
    }
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // Clean up the bundle file on every path, not just success.
    try {
      await deps.rm(deps.bundleOutput, { force: true });
      deps.log('\nCleaned up bundle file');
    } catch (cleanupError) {
      deps.error(
        'Bundle cleanup failed:',
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      );
      // Don't mask a build failure; DO fail an otherwise-green run.
      if (!bodyFailed) throw cleanupError;
    }
  }

  deps.log('\nDone!');
}
