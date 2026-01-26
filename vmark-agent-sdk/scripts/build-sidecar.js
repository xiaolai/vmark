#!/usr/bin/env node
/**
 * Build script for vmark-agent-sdk sidecar
 *
 * 1. Bundle TypeScript with esbuild
 * 2. Package into standalone binary with pkg
 */

import { build } from "esbuild";
import { exec } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Platform targets for pkg
const PKG_TARGETS = {
  "darwin-arm64": "node20-macos-arm64",
  "darwin-x64": "node20-macos-x64",
  "linux-x64": "node20-linux-x64",
  "win32-x64": "node20-win-x64",
};

// Tauri binary naming convention
const BINARY_NAMES = {
  "darwin-arm64": "vmark-agent-sdk-aarch64-apple-darwin",
  "darwin-x64": "vmark-agent-sdk-x86_64-apple-darwin",
  "linux-x64": "vmark-agent-sdk-x86_64-unknown-linux-gnu",
  "win32-x64": "vmark-agent-sdk-x86_64-pc-windows-msvc.exe",
};

async function bundleTypeScript() {
  console.log("[build] Bundling TypeScript with esbuild...");

  await build({
    entryPoints: [join(ROOT, "src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    // Use CommonJS for pkg compatibility (pkg has issues with ESM)
    format: "cjs",
    outfile: join(ROOT, "dist/index.cjs"),
    // No banner for pkg - it will be a binary, not a script
    // Bundle everything
    external: [],
    minify: false, // Keep readable for debugging
    sourcemap: true,
  });

  console.log("[build] Bundle complete: dist/index.cjs");
}

async function packageBinary(target) {
  const pkgTarget = PKG_TARGETS[target];
  const binaryName = BINARY_NAMES[target];

  if (!pkgTarget || !binaryName) {
    throw new Error(`Unknown target: ${target}`);
  }

  const outputDir = join(ROOT, "../src-tauri/binaries");
  const outputPath = join(outputDir, binaryName);

  console.log(`[build] Packaging for ${target}...`);

  // Run pkg
  const pkgCmd = `npx pkg dist/index.cjs --target ${pkgTarget} --output "${outputPath}"`;
  console.log(`[build] Running: ${pkgCmd}`);

  try {
    const { stdout, stderr } = await execAsync(pkgCmd, { cwd: ROOT });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error(`[build] pkg failed:`, error.message);
    throw error;
  }

  // Report binary size
  try {
    const stats = await stat(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`[build] Binary size: ${sizeMB} MB`);
  } catch {
    console.log(`[build] Could not stat binary at ${outputPath}`);
  }

  return outputPath;
}

async function main() {
  const args = process.argv.slice(2);

  // Determine target platform
  let target = `${process.platform}-${process.arch}`;
  if (args.includes("--all")) {
    // Build all platforms
    await bundleTypeScript();
    for (const t of Object.keys(PKG_TARGETS)) {
      try {
        await packageBinary(t);
      } catch (error) {
        console.error(`[build] Failed to build for ${t}:`, error.message);
      }
    }
    return;
  }

  // Build for current platform only
  await bundleTypeScript();

  if (args.includes("--no-pkg")) {
    console.log("[build] Skipping pkg (--no-pkg flag)");
    return;
  }

  await packageBinary(target);
  console.log("[build] Done!");
}

main().catch((error) => {
  console.error("[build] Fatal error:", error);
  process.exit(1);
});
