// WI-UI0.4 (C12) — self-test for scripts/check-theme-names.sh.
/**
 * The gate greps `git ls-files` for quoted theme names outside the allowlist,
 * so the fixture is a scratch git REPOSITORY with the real script copied in —
 * a stub would prove nothing about the grep pipeline that does the work.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-theme-names.sh");

function scratchRepo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "theme-names-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.email", "gate@example.test");
  git("config", "user.name", "Gate Fixture");
  git("config", "commit.gpgsign", "false");
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(dir, "scripts", "check-theme-names.sh"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git("add", "-A");
  return dir;
}

function run(dir) {
  return spawnSync("bash", ["scripts/check-theme-names.sh"], { cwd: dir, encoding: "utf8" });
}

describe("check-theme-names.sh", () => {
  it("fails on a quoted theme name outside the allowlist, naming the file", () => {
    const dir = scratchRepo({ "src/components/Leak.ts": `const t = "night";\n` });
    try {
      const res = run(dir);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("src/components/Leak.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes a theme name inside the catalog (allowlisted path)", () => {
    const dir = scratchRepo({ "src/theme/themes/night.ts": `export const id = "night";\n` });
    try {
      expect(run(dir).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores bare prose mentions — only QUOTED names count", () => {
    const dir = scratchRepo({ "src/components/Prose.ts": `// white space handling\n` });
    try {
      expect(run(dir).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
