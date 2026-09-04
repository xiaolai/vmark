/**
 * Refuse to drive an app whose executable has been rebuilt UNDER it.
 *
 * `pnpm tauri:dev` rebuilds when a Rust file changes, and a `cargo build` from
 * another shell rewrites `target/debug/vmark` too — but neither is guaranteed to
 * restart the process (measured 2026-09-04: a rebuild that landed 36 s after
 * launch left the old process running). The process keeps running the old
 * code; macOS keys keychain access on the code identity it verifies AGAINST
 * THE FILE, so a write still succeeds and the read back of the item the app
 * itself just wrote fails with `errSecAuthFailed` — "The user name or
 * passphrase you entered is not correct", which names nothing that happened.
 * Journey 34 (`browser-session-roundtrip`) failed that way three times against
 * such processes and passed the moment the app was restarted; a standalone
 * ad-hoc binary round-tripped the keychain in the same shell.
 *
 * The predicate is the executable itself. Cargo places `target/debug/vmark` by
 * REMOVING the old file and copying the fresh artifact in (measured: link count
 * 1, and a new inode at every rebuild of 2026-09-04 — 208183964 → 208283475 →
 * 208286491 → 208383781), so the inode the process is running (its `txt`
 * mapping) stops matching the inode at the path the moment a rebuild lands. That
 * is stateless and catches a replacement that happened before the harness ever
 * looked — a per-pid record of the first-seen hash could not (round 5, #204: it
 * was also keyed by a pid that the OS reuses). A binary cargo did not rebuild
 * keeps its inode and its bytes, and is left alone; a same-inode rewrite with
 * different bytes is not something this toolchain produces.
 *
 * Fails OPEN only where it cannot look — no `lsof`, no pid on the bridge port —
 * and says so on stderr, so a skipped check is never silent.
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

/**
 * The pure decision: the inode the process is running versus the inode now at
 * its executable's path. Returns "" to proceed or the refusal message.
 */
export function staleBinaryVerdict({ pid, executable, runningInode, diskInode }) {
  if (runningInode === null || diskInode === null) return "";
  if (runningInode === diskInode) return "";
  return (
    `the running app (pid ${pid}) was launched from a binary that has since been replaced on disk ` +
    `(${executable}: running inode ${runningInode}, on disk ${diskInode}). Its code identity no longer ` +
    `matches the file, so keychain reads fail with "user name or passphrase" errors and every journey ` +
    `describes code that is not the built code. Restart \`pnpm tauri:dev\`.`
  );
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The pid listening on the debug bridge port, or null when it cannot be found. */
export function bridgeListenerPid(port) {
  try {
    const out = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).trim();
    const pid = Number.parseInt(out.split("\n")[0], 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * The executable a process is running — its path and the inode of the mapped
 * file — from `lsof`'s `txt` entries (`-F ni`: one `i<inode>` and one `n<path>`
 * line per file). The executable is the first entry that is not a library.
 */
export function runningExecutable(pid) {
  try {
    const out = run("lsof", ["-p", String(pid), "-a", "-d", "txt", "-Fni"]);
    let inode = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("i")) inode = line.slice(1);
      if (line.startsWith("n")) {
        const path = line.slice(1);
        if (!/\.(dylib|framework)\b|\/Frameworks\/|\/usr\/lib\//.test(path)) return { path, inode };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The inode now at `path`, as a string, or null when it cannot be read. */
export function diskInodeOf(path) {
  try {
    return String(statSync(path).ino);
  } catch {
    return null;
  }
}

/**
 * Check the app behind the bridge port. Returns "" to proceed, or the refusal.
 * Prints ONE stderr line when it cannot look, so a skipped check is never silent.
 */
export function checkRunningAppIdentity(port, { log = (m) => console.error(m) } = {}) {
  const pid = bridgeListenerPid(port);
  if (pid === null) {
    log(`stale-binary guard skipped: no process found listening on ${port} (lsof)`);
    return "";
  }
  const running = runningExecutable(pid);
  if (!running || running.inode === null) {
    log(`stale-binary guard skipped: could not read the executable of pid ${pid}`);
    return "";
  }
  const diskInode = diskInodeOf(running.path);
  if (diskInode === null) {
    log(`stale-binary guard skipped: ${running.path} is not on disk any more`);
    return "";
  }
  return staleBinaryVerdict({ pid, executable: running.path, runningInode: running.inode, diskInode });
}
