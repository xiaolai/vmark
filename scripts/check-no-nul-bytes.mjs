#!/usr/bin/env node
/**
 * Purpose: refuse a tracked TEXT file that contains a raw NUL byte (U+0000).
 * Run as `pnpm lint:no-nul-bytes`; wired into `check:static`, so CI's required
 * `frontend` check blocks on it.
 *
 * WHY. A NUL is what every content-sniffing tool uses to decide a file is
 * BINARY, and the consequence is silence rather than an error:
 *
 *   - `grep -I` (and ugrep, ripgrep, and the Claude Code shell shims built on
 *     them) SKIP the file and exit 1 — indistinguishable from "no match".
 *   - `git diff` renders "Binary files differ" instead of a reviewable patch.
 *   - GitHub's blob view refuses to render it.
 *
 * Eleven files in this repository had one, including
 * `scripts/check-commit-message.mjs` — the gate that exists because a commit
 * message leaked ~20 live credentials. Grepping that file for its own exported
 * symbol returned nothing, with exit 1 and no message. A security grep that
 * quietly reports "clean" is the quiet-failure class `AGENTS.md` names
 * explicitly, so the fix ships with this assertion rather than alone.
 *
 * Every site was a deliberate NUL used as a separator or as test data. None of
 * them needed to be a raw byte: the escape `\u0000` is the identical string
 * value and leaves the file plain text. That is the fix this gate asks for.
 *
 * Key decisions:
 *   - Unknown extensions are treated as TEXT and therefore CHECKED. Skipping
 *     by default is how a gate goes quiet; a genuinely binary new file type
 *     fails loudly once and is added to BINARY_EXTENSIONS deliberately.
 *   - Binary files are identified by EXTENSION, never by asking git. Git's own
 *     text/binary detection keys on the presence of a NUL, so
 *     `git ls-files --eol` would classify exactly the offending files as
 *     binary and skip them — a circular test that always passes.
 *   - Measured clean on adoption (92 binaries: 87 .png, 3 .ico, 2 .icns; zero
 *     text files), so it ships zero-tolerance with NO baseline. A baseline here
 *     would list files known to be invisible to grep.
 *   - Reports line:col, because a NUL is invisible in the offending line and
 *     "somewhere in this file" is not an actionable message.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Extensions whose files legitimately contain NUL. Everything not listed here
 * is checked — see the header on why the default points this way.
 */
const BINARY_EXTENSIONS = new Set([
  // present in this repository
  "png", "ico", "icns",
  // forward-looking: binary formats a UI/Tauri repo plausibly gains
  "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tiff", "heic",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "zip", "gz", "bz2", "xz", "tar", "7z",
  "wasm", "dylib", "so", "dll", "a", "o", "node",
  "dmg", "pkg", "exe", "msi", "app",
  "mp3", "mp4", "mov", "wav", "m4a", "webm", "ogg",
  "sqlite", "db", "bin", "dat",
]);

/** Byte offset -> 1-based line and column, counting LF. */
function locate(buf, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function extensionOf(rel) {
  const base = path.basename(rel);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Every NUL in a tracked text file under `root`.
 *
 * @param {string} root repository root to scan
 * @returns {{file: string, line: number, column: number, count: number}[]}
 */
export function findNulBytes(root) {
  const listed = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    maxBuffer: 1 << 28,
  })
    .toString()
    .split("\0")
    .filter(Boolean);

  const findings = [];
  for (const rel of listed) {
    if (BINARY_EXTENSIONS.has(extensionOf(rel))) continue;

    const abs = path.join(root, rel);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue; // deleted from the worktree but still in the index
    }
    if (!stat.isFile()) continue;

    const buf = readFileSync(abs);
    const first = buf.indexOf(0);
    if (first === -1) continue;

    let count = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0) count += 1;

    findings.push({ file: rel, ...locate(buf, first), count });
  }
  return findings;
}

function main(argv) {
  const rootFlag = argv.indexOf("--root");
  const root =
    rootFlag === -1
      ? path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
      : path.resolve(argv[rootFlag + 1]);

  let findings;
  try {
    findings = findNulBytes(root);
  } catch (error) {
    // Fail closed: an unreadable tree is not a pass.
    console.error(
      `check-no-nul-bytes: could not scan ${root}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(64);
  }

  if (findings.length > 0) {
    console.error("Raw NUL bytes in tracked text files:\n");
    for (const f of findings) {
      const plural = f.count === 1 ? "1 NUL" : `${f.count} NULs`;
      console.error(`  ${f.file}:${f.line}:${f.column}  (${plural})`);
    }
    console.error(
      "\nA NUL makes the whole file BINARY to grep -I, git diff and GitHub —" +
        "\nthey skip it silently rather than reporting an error." +
        "\n\nWrite the escape \\u0000 instead. It is the identical string value" +
        "\nand leaves the file plain text.",
    );
    process.exit(1);
  }

  console.log("No raw NUL bytes in tracked text files.");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
