/**
 * Dev-box disk advisory for `src-tauri/target`.
 *
 * Purpose: make Cargo's unbounded build-artifact growth VISIBLE before it
 * becomes a 149 GB surprise, without ever blocking a build.
 *
 * Why this exists at all, and why it is not tied to releases:
 *   - Releases are built by CI (`tauri-apps/tauri-action`); there is no
 *     `tauri build` script in this repo and no `target/release/bundle/` on a
 *     dev machine that has cut ~30 releases. A post-release cleanup step would
 *     clean something the release never made.
 *   - Measured on 2026-08-07, `src-tauri/target` was 149 GB, of which `debug/`
 *     was 137 GB (92%) — the daily `tauri dev` / `cargo test` / `cargo clippy`
 *     loop. `release/` was 2.0 GB. The growth tracks TIME and DEPENDENCY CHURN,
 *     not releases: Cargo has no garbage collector, so every Dependabot bump
 *     compiles a new rlib and the superseded one is never reclaimed.
 *
 * Key decisions:
 *   - ADVISORY, never a gate. Every path that cannot produce a trustworthy
 *     number returns null rather than guessing. A bogus "0 B" advisory would
 *     train the reader to ignore the real one.
 *   - Local-only by construction. This is deliberately NOT wired into
 *     `check:all`: CI runners are ephemeral with empty caches, so the number is
 *     meaningless there — and `check-scripts-parity.test.mjs` requires every
 *     `check:all` gate to be reachable from a CI job, which this must not be.
 *   - The `du` probe is TIME-BOUNDED. A slow or stalled filesystem must read as
 *     "no measurement", never as "small", and must never delay `pnpm tauri:dev`
 *     by more than the bound.
 *
 * @coordinates-with scripts/tauri-wrapper.mjs — calls this before dev/build
 * @coordinates-with scripts/clean-dev.sh — the command this message points at
 * @module scripts/dev-disk
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** Advise above 40 GiB — roughly 4x a healthy full debug tree for this repo. */
export const WARN_BYTES = 40 * 1024 ** 3;

/** How long `du` may run before we give up and say nothing. */
export const PROBE_TIMEOUT_MS = 5000;

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

/** Human-readable size. Whole bytes below 1 KiB, one decimal above. */
export function formatBytes(bytes) {
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${n} B` : `${n.toFixed(1)} ${UNITS[unit]}`;
}

/** True only for a real, non-negative, finite byte count. */
function isMeasurement(bytes) {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0;
}

/**
 * The advisory text for a measured size, or null if nothing should be said.
 *
 * Returns null for any non-measurement so callers need no guard of their own.
 */
export function diskWarning(bytes, { threshold = WARN_BYTES } = {}) {
  if (!isMeasurement(bytes) || bytes < threshold) return null;

  return (
    `\nsrc-tauri/target is ${formatBytes(bytes)}.\n\n` +
    `Cargo has no garbage collector: artifacts from superseded dependency\n` +
    `versions are never reclaimed, so this grows with dependency churn rather\n` +
    `than with releases (releases are built in CI and leave nothing here).\n\n` +
    `Reclaim it when convenient — the next build is a cold one:\n\n` +
    `  pnpm clean:dev\n`
  );
}

/**
 * Size of `dir` in bytes via `du -sk`, or null if it could not be measured.
 *
 * `existsFn` and `runFn` are injected so every branch is testable without a
 * filesystem or a subprocess.
 */
export function measureDirBytes(dir, { existsFn = existsSync, runFn = defaultRun } = {}) {
  try {
    if (!existsFn(dir)) return null;
    const result = runFn(dir);
    if (!result || result.error || result.status !== 0) return null;
    const kib = Number.parseInt(String(result.stdout ?? "").trim().split(/\s+/)[0], 10);
    if (!Number.isFinite(kib) || kib < 0) return null;
    return kib * 1024;
  } catch {
    return null;
  }
}

function defaultRun(dir) {
  return spawnSync("du", ["-sk", dir], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
  });
}

/** Measure `dir` and return its advisory, or null. Never throws. */
export function checkDevDisk(dir, options = {}) {
  return diskWarning(measureDirBytes(dir, options), options);
}
