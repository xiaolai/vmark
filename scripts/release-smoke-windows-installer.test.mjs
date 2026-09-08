/**
 * The release-smoke job that installs and uninstalls the published NSIS
 * installer on a real Windows runner (WI-FL6.6) — and the ways it could stop
 * proving anything while still looking wired up.
 *
 * `src-tauri/windows/installer-hooks.nsh` restores `HKCR\.txt\ShellNew` — the
 * key behind "New > Text Document" for EVERY application — after a VMark
 * uninstall once removed it (#1142). It was authored on macOS and its own
 * header says it was never run on Windows. This job runs the shipped
 * installer through install → uninstall, from the outside, and reads the
 * registry back.
 *
 * Two cycles, because the current Tauri uninstaller does NOT delete ShellNew
 * on its own, so a plain cycle cannot show the hook doing anything:
 *
 *   1. plain — after uninstall the ShellNew key is present and the `.txt`
 *      association is what it was before the install (no collateral damage);
 *   2. the #1142 damage first — the machine-wide ShellNew key is deleted
 *      before the uninstall, so its presence afterwards can only mean the
 *      POSTUNINSTALL hook wrote it.
 *
 * Pinned here: the job exists on windows-latest and is independent of the
 * macOS job; the installer is downloaded by its `-setup.exe` name; install and
 * uninstall are silent (`/S`) and the uninstall is waited for (`_?=`, the NSIS
 * idiom that stops the uninstaller from forking a temp copy); the ShellNew
 * `NullFile` value is asserted; cycle 2 deletes the key first; the uninstall
 * registry entry is asserted gone; every PowerShell step declares `pwsh` and
 * `$ErrorActionPreference = 'Stop'`, so a failing cmdlet fails the step; and
 * event-supplied values reach the shell through `env`, never interpolation.
 *
 * @coordinates-with .github/workflows/release-smoke.yml
 * @coordinates-with src-tauri/windows/installer-hooks.nsh
 * @module scripts/release-smoke-windows-installer.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = parseYaml(
  readFileSync(path.join(REPO, ".github/workflows/release-smoke.yml"), "utf8"),
);
const job = workflow.jobs["windows-installer"];
const steps = job?.steps ?? [];
const runs = steps.map((s) => String(s.run ?? ""));
const pwshSteps = steps.filter((s) => s.shell === "pwsh");
const cycleStep = pwshSteps.find((s) => /Uninstall/i.test(String(s.run ?? "")));
const cycle = String(cycleStep?.run ?? "");

describe("release-smoke: windows-installer", () => {
  it("exists on windows-latest, bounded, and independent of the macOS job", () => {
    expect(job, "no windows-installer job").toBeDefined();
    expect(job["runs-on"]).toBe("windows-latest");
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(20);
    // A macOS failure must not skip the Windows evidence, and vice versa.
    expect(job.needs).toBeUndefined();
  });

  it("downloads the published NSIS installer by its -setup.exe name", () => {
    const download = steps.find((s) => /gh release download/.test(String(s.run ?? "")));
    expect(download, "no gh release download step").toBeDefined();
    expect(String(download.run)).toMatch(/--pattern '\*-setup\.exe'/);
    // No checkout in this job: gh needs the repository from the environment.
    expect(download.env?.GH_REPO).toBe("${{ github.repository }}");
    expect(download.env?.GH_TOKEN).toBeDefined();
  });

  it("passes event-supplied values through env, never into the shell body", () => {
    for (const run of runs) expect(run).not.toMatch(/\$\{\{\s*github\.event/);
  });

  it("installs and uninstalls silently, waiting for the in-place uninstaller", () => {
    expect(cycleStep, "no pwsh step that uninstalls").toBeDefined();
    expect(cycle).toMatch(/Start-Process[^\n]*-ArgumentList '\/S'[^\n]*-Wait/);
    expect(cycle).toMatch(/Start-Process[^\n]*'\/S',\s*"_\?=\$dir"[^\n]*-Wait/);
    expect(cycle).toMatch(/Uninstall\\VMark/);
  });

  it("asserts the ShellNew NullFile value after uninstall, and the .txt association", () => {
    expect(cycle).toMatch(/\.txt\\ShellNew/);
    expect(cycle).toMatch(/NullFile/);
    expect(cycle).toMatch(/after uninstall \(cycle 1\)/);
    expect(cycle).toMatch(/after uninstall \(cycle 2\)/);
    expect(cycle).toMatch(/\(default\)/);
  });

  it("runs the #1142 damage before cycle 2's uninstall, so presence proves the hook", () => {
    // ShellNew is deleted wherever it lives — both hives — before the uninstall.
    expect(cycle).toMatch(/HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\\.txt\\ShellNew/);
    expect(cycle).toMatch(/HKEY_CURRENT_USER\\Software\\Classes\\\.txt\\ShellNew/);
    expect(cycle).toMatch(/foreach \(\$key in \$shellNewKeys\)[^\n]*\n[^\n]*Remove-Item -Path \$key -Recurse -Force/);
    // The deletion happens between the LAST install and the LAST uninstall
    // (calls come after the function definitions, so lastIndexOf is the call).
    const damage = cycle.indexOf("Remove-Item -Path $key");
    const lastInstall = cycle.lastIndexOf("Install-Silently");
    const lastUninstall = cycle.lastIndexOf("Uninstall-Silently");
    expect(damage).toBeGreaterThan(lastInstall);
    expect(damage).toBeLessThan(lastUninstall);
    // The precondition is asserted, not assumed: the merged view must be empty
    // before the uninstall, or presence afterwards proves nothing.
    expect(cycle).toMatch(/precondition: could not remove/);
    // And it needs elevation, which the step verifies rather than assumes.
    expect(cycle).toMatch(/Administrator/);
  });

  it("asserts the uninstall really removed the app", () => {
    expect(cycle).toMatch(/Uninstall registry entry is still there/);
    expect(cycle).toMatch(/main binary is still there/);
  });

  it("makes every PowerShell step fail on the first failing cmdlet", () => {
    expect(pwshSteps.length).toBeGreaterThan(0);
    for (const step of pwshSteps) {
      expect(String(step.run)).toMatch(/^\s*\$ErrorActionPreference = 'Stop'/);
    }
  });
});
