/**
 * Self-test for the trusted-HTML contract gate.
 *
 * A gate that cannot fail is indistinguishable from no gate, and this one
 * guards a seam whose breakage is silent (a preview pane that shows nothing).
 * So the checks here are: it passes on the real tree, and it FAILS on each
 * specific drift it claims to catch.
 *
 * The drift cases run the detector against mutated copies of the real files in
 * a temp repo, rather than against hand-written fixtures — a fixture would
 * drift from the real file shapes and the gate would go quietly blind.
 *
 * @coordinates-with check-trusted-html-contract.mjs — the gate under test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(REPO, "scripts/check-trusted-html-contract.mjs");

const TRACKED = [
  "src-tauri/src/trusted_html/protocol.rs",
  "src/lib/formats/adapters/htmlTrust.ts",
  "src/services/trustedHtml/trustedHtmlBridge.ts",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/lib.rs",
];

let sandbox;

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "trusted-html-gate-"));
  mkdirSync(path.join(sandbox, "scripts"), { recursive: true });
  cpSync(GATE, path.join(sandbox, "scripts/check-trusted-html-contract.mjs"));
  for (const rel of TRACKED) {
    mkdirSync(path.join(sandbox, path.dirname(rel)), { recursive: true });
    cpSync(path.join(REPO, rel), path.join(sandbox, rel));
  }
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

/** Run the gate in the sandbox, returning `{ status, output }`. */
function runGate() {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(sandbox, "scripts/check-trusted-html-contract.mjs")],
      { encoding: "utf8" },
    );
    return { status: 0, output: stdout };
  } catch (e) {
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Mutate one sandbox file for the duration of `fn`, then restore it. */
function withMutation(rel, mutate, fn) {
  const file = path.join(sandbox, rel);
  const original = readFileSync(file, "utf8");
  try {
    const next = mutate(original);
    expect(next, `mutation for ${rel} changed nothing — the pattern is stale`).not.toBe(
      original,
    );
    writeFileSync(file, next);
    return fn();
  } finally {
    writeFileSync(file, original);
  }
}

describe("check-trusted-html-contract", () => {
  it("passes against the real repository", () => {
    expect(runGate().status).toBe(0);
  });

  it("fails when the TypeScript scheme drifts from the Rust one", () => {
    withMutation(
      "src/lib/formats/adapters/htmlTrust.ts",
      (s) => s.replace('TRUSTED_SCHEME = "vmark-trusted"', 'TRUSTED_SCHEME = "vmark-trusted-v2"'),
      () => {
        const { status, output } = runGate();
        expect(status).not.toBe(0);
        expect(output).toMatch(/scheme mismatch/);
      },
    );
  });

  it("fails when the CSP stops allowing the scheme in frame-src", () => {
    withMutation(
      "src-tauri/tauri.conf.json",
      (s) => s.replace("frame-src 'self' vmark-trusted:", "frame-src 'self'"),
      () => {
        const { status, output } = runGate();
        expect(status).not.toBe(0);
        expect(output).toMatch(/frame-src/);
      },
    );
  });

  it("fails when frame-src is removed altogether", () => {
    withMutation(
      "src-tauri/tauri.conf.json",
      (s) => s.replace("; frame-src 'self' vmark-trusted:", ""),
      () => {
        const { status, output } = runGate();
        expect(status).not.toBe(0);
        expect(output).toMatch(/no explicit frame-src/);
      },
    );
  });

  it("fails when the token length disagrees across languages", () => {
    withMutation(
      "src-tauri/src/trusted_html/protocol.rs",
      (s) => s.replace("const TOKEN_LEN: usize = 64", "const TOKEN_LEN: usize = 32"),
      () => {
        const { status, output } = runGate();
        expect(status).not.toBe(0);
        expect(output).toMatch(/token length mismatch/);
      },
    );
  });

  it("fails when the builder registers a literal instead of the constant", () => {
    withMutation(
      "src-tauri/src/lib.rs",
      (s) =>
        s.replace(
          "register_uri_scheme_protocol(trusted_html::protocol::SCHEME",
          'register_uri_scheme_protocol("vmark-trusted"',
        ),
      () => {
        const { status, output } = runGate();
        expect(status).not.toBe(0);
        expect(output).toMatch(/registered as/);
      },
    );
  });

  /// A detector that silently finds nothing is the failure mode this whole
  /// gate exists to prevent, so a missing constant is an error, not a pass.
  it("fails loudly when a constant it reads has been renamed away", () => {
    withMutation(
      "src-tauri/src/trusted_html/protocol.rs",
      (s) => s.replace("pub const SCHEME:", "pub const URI_SCHEME:"),
      () => {
        const { status, output } = runGate();
        expect(status).not.toBe(0);
        expect(output).toMatch(/no match for/);
      },
    );
  });
});
