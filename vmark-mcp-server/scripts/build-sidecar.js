#!/usr/bin/env node
/**
 * Build script for VMark MCP Server sidecar binary.
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

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, access, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:os';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const TAURI_BINARIES_DIR = join(PROJECT_ROOT, '..', 'src-tauri', 'binaries');
const BUNDLE_OUTPUT = join(PROJECT_ROOT, 'dist', 'cli.bundle.cjs');

/**
 * Map platform/arch to Tauri target triple and pkg target.
 */
const TARGET_MAP = {
  'darwin-arm64': {
    triple: 'aarch64-apple-darwin',
    pkg: 'node18-macos-arm64',
  },
  'darwin-x64': {
    triple: 'x86_64-apple-darwin',
    pkg: 'node18-macos-x64',
  },
  'win32-x64': {
    triple: 'x86_64-pc-windows-msvc',
    pkg: 'node18-win-x64',
    ext: '.exe',
  },
  'linux-x64': {
    triple: 'x86_64-unknown-linux-gnu',
    pkg: 'node18-linux-x64',
  },
};

/**
 * Get the current platform target key.
 */
function getCurrentTargetKey() {
  return `${platform()}-${arch()}`;
}

/**
 * Bundle the code with esbuild into a single CJS file.
 */
async function bundleWithEsbuild() {
  console.log('Bundling with esbuild...');

  const esbuildCmd = [
    'npx',
    'esbuild',
    join(PROJECT_ROOT, 'src', 'cli.ts'),
    '--bundle',
    '--platform=node',
    '--target=node18',
    '--format=cjs',
    `--outfile=${BUNDLE_OUTPUT}`,
    '--external:fsevents', // Optional macOS dependency
  ].join(' ');

  console.log(`Running: ${esbuildCmd}`);
  const { stdout, stderr } = await execAsync(esbuildCmd, { cwd: PROJECT_ROOT });

  if (stdout) console.log(stdout);
  if (stderr && !stderr.includes('Done')) console.error(stderr);

  // Verify bundle exists
  await access(BUNDLE_OUTPUT);
  console.log(`Bundle created: ${BUNDLE_OUTPUT}\n`);
}

/**
 * Build sidecar for a specific target.
 */
async function buildForTarget(targetKey) {
  const target = TARGET_MAP[targetKey];
  if (!target) {
    console.error(`Unknown target: ${targetKey}`);
    return false;
  }

  const ext = target.ext || '';
  const outputName = `vmark-mcp-server-${target.triple}${ext}`;
  const outputPath = join(TAURI_BINARIES_DIR, outputName);

  console.log(`Building for ${targetKey} -> ${outputName}`);

  try {
    // Create binaries directory if it doesn't exist
    await mkdir(TAURI_BINARIES_DIR, { recursive: true });

    // Run pkg to create the binary from the bundle
    const pkgCmd = [
      'npx',
      '@yao-pkg/pkg',
      BUNDLE_OUTPUT,
      '--target', target.pkg,
      '--output', outputPath,
      '--compress', 'GZip',
    ].join(' ');

    console.log(`Running: ${pkgCmd}`);
    const { stdout, stderr } = await execAsync(pkgCmd, { cwd: PROJECT_ROOT });

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    // Verify output exists
    await access(outputPath);
    console.log(`Successfully built: ${outputPath}`);

    return true;
  } catch (error) {
    console.error(`Failed to build for ${targetKey}:`, error.message);
    return false;
  }
}

/**
 * Main build function.
 */
async function main() {
  const args = process.argv.slice(2);
  const buildAll = args.includes('--all');
  const buildMacosUniversal = args.includes('--macos-universal');

  console.log('VMark MCP Server Sidecar Builder');
  console.log('================================\n');

  // Step 1: Bundle with esbuild
  await bundleWithEsbuild();

  // Step 2: Package with pkg
  if (buildMacosUniversal) {
    // Build both macOS architectures and combine into universal binary
    console.log('Building for macOS universal (arm64 + x64)...\n');
    const macosTargets = ['darwin-arm64', 'darwin-x64'];

    // Build sequentially to avoid race conditions
    for (const target of macosTargets) {
      const success = await buildForTarget(target);
      if (!success) {
        console.error(`Failed to build ${target}, aborting`);
        process.exit(1);
      }
    }

    // Combine into universal binary using lipo
    const arm64Path = join(TAURI_BINARIES_DIR, 'vmark-mcp-server-aarch64-apple-darwin');
    const x64Path = join(TAURI_BINARIES_DIR, 'vmark-mcp-server-x86_64-apple-darwin');
    const universalPath = join(TAURI_BINARIES_DIR, 'vmark-mcp-server-universal-apple-darwin');

    console.log('\nCreating universal binary with lipo...');
    const lipoCmd = `lipo -create -output "${universalPath}" "${arm64Path}" "${x64Path}"`;
    console.log(`Running: ${lipoCmd}`);

    try {
      await execAsync(lipoCmd);
      await access(universalPath);
      console.log(`Successfully created universal binary: ${universalPath}`);

      // Clean up arch-specific binaries (optional, but keeps things tidy)
      await rm(arm64Path);
      await rm(x64Path);
      console.log('Cleaned up arch-specific binaries');
    } catch (error) {
      console.error('Failed to create universal binary:', error.message);
      process.exit(1);
    }
  } else if (buildAll) {
    // Build for all platforms
    console.log('Building for all platforms...\n');
    const results = await Promise.all(
      Object.keys(TARGET_MAP).map(buildForTarget)
    );
    const successCount = results.filter(Boolean).length;
    console.log(`\nBuilt ${successCount}/${Object.keys(TARGET_MAP).length} targets`);
  } else {
    // Build for current platform only
    const targetKey = getCurrentTargetKey();
    console.log(`Building for current platform: ${targetKey}\n`);

    if (!TARGET_MAP[targetKey]) {
      console.error(`Unsupported platform: ${targetKey}`);
      console.error('Supported platforms:', Object.keys(TARGET_MAP).join(', '));
      process.exit(1);
    }

    const success = await buildForTarget(targetKey);
    if (!success) {
      process.exit(1);
    }
  }

  // Clean up bundle file
  try {
    await rm(BUNDLE_OUTPUT);
    console.log('\nCleaned up bundle file');
  } catch {
    // Ignore cleanup errors
  }

  console.log('\nDone!');
}

main().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
