/**
 * The release-smoke job that installs and uninstalls the published NSIS
 * installer on a real Windows runner (WI-FL6.6) — and the ways it could stop
 * proving anything while still looking wired up.
 *
 * `src-tauri/windows/installer-hooks.nsh` restores `HKCR\.txt\ShellNew` — the
 * key behind "New > Text Document" for EVERY application — after a VMark
 * uninstall once removed it (#1142). It was authored on macOS and had never
 * run on Windows until this job put it on one. This job runs the shipped
 * installer through install → uninstall, from the outside, and reads the
 * registry back.
 *
 * Two cycles, because the current Tauri uninstaller does NOT delete ShellNew
 * on its own, so a plain cycle cannot show the hook doing anything:
 *
 *   1. plain — after uninstall EVERY claimed association is what it was
 *      before the install (no collateral damage), and ShellNew is present;
 *   2. the #1142 damage first — the machine-wide ShellNew key is deleted
 *      before the uninstall, so its presence afterwards can only mean the
 *      POSTUNINSTALL hook wrote it.
 *
 * Both cycles reported for the first time on v0.9.67 (run 34313339017). What
 * the first execution found, on v0.9.66, is why cycle 1 now compares the whole
 * claimed set rather than `.txt` alone: the uninstaller was wiping FOUR
 * associations it does not own — `.txt`, `.svg`, `.html`, `.htm` — and a
 * `.txt`-only assertion would have reported one of them.
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
const hooks = readFileSync(path.join(REPO, "src-tauri/windows/installer-hooks.nsh"), "utf8");
const tauriConf = JSON.parse(readFileSync(path.join(REPO, "src-tauri/tauri.conf.json"), "utf8"));

/** Every extension tauri.conf.json claims — the authority both lists copy. */
const CLAIMED_EXTS = (tauriConf.bundle?.fileAssociations ?? []).flatMap((a) => a.ext ?? []);
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

  it("checks the association round-trip for the WHOLE claimed set, in both cycles", () => {
    // The v0.9.66 run compared only `.txt`. The defect is per-extension, so a
    // .txt-only check would pass a build that still shadows .html and .svg.
    expect(cycle).toMatch(/function Get-AssocDefaults/);
    expect(cycle).toMatch(/function Assert-AssocRestored/);
    expect(cycle).toMatch(/Assert-AssocRestored \$assocBefore 'after uninstall \(cycle 1\)'/);
    expect(cycle).toMatch(/Assert-AssocRestored \$assocBefore 'after uninstall \(cycle 2\)'/);
    // Snapshot taken BEFORE the first install, or it cannot show a change.
    expect(cycle.indexOf("$assocBefore = Get-AssocDefaults")).toBeLessThan(
      cycle.indexOf("Install-Silently\n"),
    );
  });

  it("logs every damaged association before throwing, so none is truncated away", () => {
    // Measured: PowerShell elided the v0.9.66 failure message after two
    // entries, so the run proved damage existed but not how much. The list has
    // to reach the log outside the exception text.
    // The YAML block scalar is parsed with its common indent stripped, so the
    // function's closing brace sits at column 0.
    const assertFn = cycle.match(/function Assert-AssocRestored[\s\S]*?\n\}/);
    expect(assertFn, "no Assert-AssocRestored function").not.toBeNull();
    const body = assertFn[0];
    const logLoop = body.indexOf("foreach ($line in $broken)");
    // `throw "`, not `throw ` — the explanatory comment above the statement
    // contains the bare word, and a detector that matches prose is the trap
    // this repo has paid for before.
    const thrown = body.indexOf('throw "');
    expect(logLoop, "the broken list is never written to the log").toBeGreaterThan(-1);
    expect(logLoop, "the list must be logged BEFORE the throw ends the step").toBeLessThan(thrown);
  });

  it("keeps the job's extension list identical to tauri.conf.json", () => {
    // The job does no checkout, so the list is literal in the workflow. That is
    // a copy, and a copy drifts — this is the join that stops it.
    const block = cycle.match(/\$assocExts = @\(([\s\S]*?)\)/);
    expect(block, "no $assocExts list in the windows-installer job").not.toBeNull();
    const listed = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed.slice().sort()).toEqual(CLAIMED_EXTS.slice().sort());
  });
});

// The POSTUNINSTALL repair itself. Tauri's APP_UNASSOCIATE writes the backed-up
// ProgID back UNCONDITIONALLY, and for a per-user install that backup was read
// from HKCU — a hive that never held the machine-wide association. So it writes
// an empty default into HKCU, which shadows HKLM in the merged HKCR view and
// leaves the extension with no handler. The hook deletes that empty value.
describe("installer-hooks.nsh: the association un-shadow", () => {
  const covered = [...hooks.matchAll(/!insertmacro VMARK_UNSHADOW_ASSOCIATION "([^"]+)"/g)].map(
    (m) => m[1],
  );

  it("covers every claimed extension, and claims no extension that is gone", () => {
    expect(CLAIMED_EXTS.length).toBeGreaterThan(0);
    // Both directions: a new fileAssociation that skips the hook reintroduces
    // the defect for that extension, and a stale entry is a dead line.
    expect(covered.slice().sort()).toEqual(CLAIMED_EXTS.slice().sort());
  });

  it("deletes the default value ONLY when it is empty", () => {
    // A non-empty default means the restore worked (per-machine install) or
    // another application has claimed the extension. Deleting it either way
    // would turn a repair into the very defect it fixes.
    const macro = hooks.match(/!macro VMARK_UNSHADOW_ASSOCIATION[\s\S]*?!macroend/);
    expect(macro, "no VMARK_UNSHADOW_ASSOCIATION macro").not.toBeNull();
    const body = macro[0];
    const deletes = [...body.matchAll(/DeleteRegValue (\w+) "Software\\Classes\\\.\$\{EXT\}" ""/g)];
    expect(deletes.map((m) => m[1]).sort()).toEqual(["HKCU", "HKLM"]);
    // Each delete is guarded by an emptiness test on the value just read.
    expect([...body.matchAll(/\$\{If\} \$R0 == ""/g)]).toHaveLength(2);
    expect([...body.matchAll(/ReadRegStr \$R0 (HKCU|HKLM) "Software\\Classes\\\.\$\{EXT\}" ""/g)])
      .toHaveLength(2);
    // The register is borrowed, not stolen: the uninstall section continues
    // after the hook.
    expect(body).toMatch(/Push \$R0[\s\S]*Pop \$R0/);
  });

  it("still restores the #1142 ShellNew key", () => {
    // The un-shadow must not have displaced the original repair; cycle 2 of the
    // smoke job is the only thing that can confirm that line, and it has not
    // reached a verdict yet.
    expect(hooks).toMatch(/WriteRegStr HKCR "\.txt\\ShellNew" "NullFile" ""/);
  });

  it("does not delete the _backup value another Tauri app may own", () => {
    // Tauri derives the file class from the bare extension when a
    // fileAssociation declares no `name`, so "txt_backup" is not unique to
    // VMark. It is inert once the default value is gone.
    expect(hooks).not.toMatch(/DeleteRegValue[^\n]*_backup/);
  });
});
