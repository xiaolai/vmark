/**
 * The NSIS installer must release the MCP sidecar's file lock BEFORE it tries
 * to overwrite or delete `vmark-mcp-server.exe` (#1648).
 *
 * Tauri's installer only checks that the MAIN binary is running. The sidecar is
 * a separate process — an AI client (Claude Desktop, Cursor, …) spawns it, or
 * it outlives a killed VMark — and Windows refuses to overwrite a running
 * executable. The File instruction then fails with NSIS's built-in English
 * "Can't write" Abort/Retry/Ignore box, and Abort ends in "Installation
 * Aborted" even though the main program was already replaced.
 *
 * That dialog cannot be localised or reworded from a hook, so the fix is to make
 * it unreachable: PREINSTALL and PREUNINSTALL stop the sidecar first. These
 * assertions pin the contract statically (the installer is only executable on
 * Windows); the binary name is read from tauri.conf.json so a rename cannot
 * leave the hook killing the wrong process.
 *
 * @coordinates-with src-tauri/windows/installer-hooks.nsh
 * @coordinates-with src-tauri/tauri.conf.json
 * @module scripts/installer-hooks-sidecar.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooks = readFileSync(path.join(REPO, "src-tauri/windows/installer-hooks.nsh"), "utf8");
const tauriConf = JSON.parse(readFileSync(path.join(REPO, "src-tauri/tauri.conf.json"), "utf8"));

/** The sidecar's installed file name: externalBin drops the directory and target triple. */
const SIDECAR_EXE = `${path.basename(tauriConf.bundle.externalBin[0])}.exe`;

/** Body of one Tauri hook macro, or null when the hook is not defined. */
function hookBody(name) {
  const m = hooks.match(new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`));
  return m ? m[1] : null;
}

describe("installer-hooks.nsh: the MCP sidecar lock (#1648)", () => {
  it("derives the sidecar name from externalBin", () => {
    expect(SIDECAR_EXE).toBe("vmark-mcp-server.exe");
  });

  it.each(["NSIS_HOOK_PREINSTALL", "NSIS_HOOK_PREUNINSTALL"])(
    "%s stops the sidecar before any file is touched",
    (name) => {
      const body = hookBody(name);
      expect(body, `${name} must be defined`).not.toBeNull();
      expect(body).toContain("VMARK_STOP_SIDECAR");
    },
  );

  const macroBody = () => hooks.match(/!macro VMARK_STOP_SIDECAR([\s\S]*?)!macroend/)?.[1] ?? "";

  it("VMARK_STOP_SIDECAR force-kills the sidecar image by name", () => {
    expect(hooks).toMatch(/!macro VMARK_STOP_SIDECAR/);
    expect(macroBody()).toContain(SIDECAR_EXE);
    expect(macroBody()).toMatch(/taskkill\.exe"? \/F \/IM/);
  });

  it("runs taskkill from $SYSDIR, never resolved through the search path", () => {
    expect(macroBody()).toContain('"$SYSDIR\\taskkill.exe"');
    expect(macroBody()).not.toMatch(/Exec '\s*taskkill/);
  });

  it("treats exit 0 (killed) and 128 (not running) as success, anything else as a hard stop", () => {
    const body = macroBody();
    expect(body).toMatch(/nsExec::Exec[^\n]*taskkill/);
    expect(body).toMatch(/\$\{If\} \$\w+ != 0/);
    expect(body).toMatch(/\$\{AndIf\} \$\w+ != 128/);
    expect(body).toMatch(/MessageBox[\s\S]*?\/SD IDOK/);
    expect(body).toMatch(/\bAbort\b/);
  });

  it("restores the caller's $R0 on the abort path as well as the normal one", () => {
    // Push once; Pop on the success path and again just before Abort.
    const body = macroBody();
    expect(body.match(/Push \$R0/g)).toHaveLength(1);
    expect(body).toMatch(/Pop \$R0\s+Abort/);
    expect(body.trimEnd()).toMatch(/Pop \$R0$/);
  });

  it("never claims 'Nothing was changed': the legacy uninstall-first path may already have run", () => {
    // Tauri runs the previously installed uninstaller (which has no kill hook)
    // from the reinstall page, before PREINSTALL. If this abort then fires, the
    // old version may already be gone, so the message must not promise otherwise.
    expect(macroBody()).not.toMatch(/nothing was changed/i);
    expect(macroBody()).toMatch(/run Setup again/);
  });

  it("names the component in the failure message, so the user knows what to do", () => {
    expect(macroBody()).toContain("MCP server");
    expect(macroBody()).toMatch(/Task Manager/);
  });

  it("waits for Windows to drop the image's file handle after the kill", () => {
    expect(macroBody()).toMatch(/Sleep \d+/);
  });
});
