#!/usr/bin/env node
/**
 * Trusted-HTML cross-layer contract gate (issue #1273).
 *
 * The trusted preview only works if four independent files agree on two
 * values, and NOTHING else checks that they do:
 *
 * | Value | Rust | TypeScript | Config |
 * |---|---|---|---|
 * | URI scheme | `protocol.rs` `SCHEME` | `htmlTrust.ts` `TRUSTED_SCHEME` | `tauri.conf.json` CSP `frame-src` |
 * | Token length | `protocol.rs` `TOKEN_LEN` | `trustedHtmlBridge.ts` token regex | — |
 *
 * Neither compiler can see across this seam, and the unit tests on both sides
 * compare each constant against another hard-coded literal in the same
 * language — so a rename stays green in every suite and fails only at runtime,
 * as a preview pane that silently shows nothing.
 *
 * This is the same class `lint:ipc-contract` exists for, at a smaller scale,
 * and it is not hypothetical here: `frame-ancestors 'self'` shipped in that CSP
 * and disabled the entire feature while every gate stayed green.
 *
 * Zero-tolerance, no baseline: the values agree today, and a baseline listing
 * a disagreement would be a list of ways the feature is already broken.
 *
 * Run: `node scripts/check-trusted-html-contract.mjs`
 */

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  protocol: "src-tauri/src/trusted_html/protocol.rs",
  vocabulary: "src/lib/formats/adapters/htmlTrust.ts",
  bridge: "src/services/trustedHtml/trustedHtmlBridge.ts",
  config: "src-tauri/tauri.conf.json",
  builder: "src-tauri/src/lib.rs",
};

const read = (key) => readFileSync(path.join(REPO, FILES[key]), "utf8");

/** Pull one capture out of `source`, or record why it could not be found. */
function extract(problems, label, source, pattern) {
  const match = source.match(pattern);
  if (!match) {
    problems.push(`${label}: no match for ${pattern} — was it renamed or reformatted?`);
    return null;
  }
  return match[1];
}

export function findings() {
  const problems = [];

  const protocol = read("protocol");
  const vocabulary = read("vocabulary");
  const bridge = read("bridge");
  const builder = read("builder");
  const config = JSON.parse(read("config"));

  // ---------------------------------------------------------------- scheme
  const rustScheme = extract(
    problems,
    FILES.protocol,
    protocol,
    /pub const SCHEME:\s*&str\s*=\s*"([^"]+)"/,
  );
  const tsScheme = extract(
    problems,
    FILES.vocabulary,
    vocabulary,
    /export const TRUSTED_SCHEME\s*=\s*"([^"]+)"/,
  );

  if (rustScheme && tsScheme && rustScheme !== tsScheme) {
    problems.push(
      `scheme mismatch: ${FILES.protocol} serves "${rustScheme}" but ` +
        `${FILES.vocabulary} builds URLs for "${tsScheme}" — the frame would 404.`,
    );
  }

  // The app cannot embed a frame its own CSP forbids.
  const csp = config?.app?.security?.csp ?? "";
  const frameSrc = /(?:^|;)\s*frame-src\s+([^;]+)/.exec(csp)?.[1] ?? null;
  if (!frameSrc) {
    problems.push(
      `${FILES.config}: CSP has no explicit frame-src, so the trusted scheme ` +
        `falls under default-src and the iframe is refused.`,
    );
  } else if (rustScheme && !frameSrc.includes(`${rustScheme}:`)) {
    problems.push(
      `${FILES.config}: frame-src "${frameSrc.trim()}" does not allow ` +
        `"${rustScheme}:" — the app would refuse to embed its own trusted preview.`,
    );
  }

  // The builder must register the scheme BY CONSTANT. A literal there would be
  // a fourth copy this gate could not see drifting.
  if (!/register_uri_scheme_protocol\(\s*trusted_html::protocol::SCHEME/.test(builder)) {
    problems.push(
      `${FILES.builder}: the trusted scheme must be registered as ` +
        `trusted_html::protocol::SCHEME, not as a string literal.`,
    );
  }

  // ----------------------------------------------------------- token length
  const rustLen = extract(
    problems,
    FILES.protocol,
    protocol,
    /const TOKEN_LEN:\s*usize\s*=\s*(\d+)/,
  );
  const tsLen = extract(
    problems,
    FILES.bridge,
    bridge,
    /\/\^\[0-9a-f\]\{(\d+)\}\$\/i/,
  );

  if (rustLen && tsLen && rustLen !== tsLen) {
    problems.push(
      `token length mismatch: ${FILES.protocol} accepts ${rustLen} hex chars ` +
        `but ${FILES.bridge} validates ${tsLen} — one side rejects every token ` +
        `the other mints.`,
    );
  }

  // `secret_token::generate_secret_token` is two simple-form UUIDs: 32 hex
  // characters each. If that ever changes, TOKEN_LEN must change with it.
  if (rustLen && Number(rustLen) !== 64) {
    problems.push(
      `${FILES.protocol}: TOKEN_LEN is ${rustLen}, but generate_secret_token ` +
        `produces 64 hex characters (two simple-form UUIDs).`,
    );
  }

  return problems;
}

/**
 * Entry-point detection, through symlinks.
 *
 * Node resolves `import.meta.url` to the REAL path but leaves `process.argv[1]`
 * as given, so on macOS — where the temp directory is `/var` → `/private/var` —
 * a plain string comparison never matches and the gate silently does nothing.
 * That is exactly how this gate first "passed" its own self-test, which runs it
 * from a copy in a temp directory: exit 0, no output, no checks performed.
 *
 * Several other gates in this directory share the weaker form. It only bites
 * when the script is reached through a symlinked path, which the repo checkout
 * is not — but a gate that no-ops silently is the failure mode this whole file
 * exists to argue against, so this one compares real paths.
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

const isMain = isMainModule();

if (isMain) {
  const problems = findings();
  if (problems.length > 0) {
    console.error("\n❌ Trusted-HTML contract broken across languages:\n");
    for (const p of problems) console.error(`  • ${p}`);
    console.error(
      "\n  These files must agree; no compiler checks them, and the symptom " +
        "is a preview\n  that silently shows nothing.\n",
    );
    process.exit(1);
  }
  console.log(
    "✅ Trusted-HTML contract OK — scheme and token length agree across Rust, TypeScript and CSP.",
  );
}
