// @vitest-environment node
/**
 * `tauri dev` must not share a profile with the installed app.
 *
 * THE MECHANISM. Every per-app path Tauri resolves — `app_data_dir()` (hot-exit
 * session state, `workspaces/`, the `mcp-port` file), `app_log_dir()`, and the
 * webview's own storage, which is where `localStorage` lives — is derived from
 * the bundle `identifier` and from nothing else. So the identifier IS the
 * profile: two builds that share it share one mutable session, with no locking
 * and no coordination between the processes.
 *
 * WHAT THAT COST. `tauri.dev.conf.json` overrode only `bundle.icon`, so a debug
 * build resolved every one of those paths to the same `app.vmark` as the
 * release app in /Applications. Running `pnpm tauri:dev` beside a running VMark
 * put two processes in a read-modify-write race over one hot-exit session; the
 * observed result was a document window whose tab strip stopped reflecting its
 * own store, and leftover tabs in the maintainer's real app afterwards. The
 * `mcp-port` file is the same collision one layer out: the dev app overwrites
 * the port and auth token the release app published, so an AI client configured
 * against the release app silently talks to the dev build — and dials a dead
 * port once the dev build exits.
 *
 * None of it was visible. Nothing read these two files together, so the dev
 * config could go on claiming to be a separate app while being the same one.
 * That is what this file is: the check that was missing, not a restatement of
 * the fix.
 *
 * @coordinates-with src-tauri/tauri.conf.json — the shipped identifier
 * @coordinates-with src-tauri/tauri.dev.conf.json — the dev override
 * @coordinates-with e2e/lib/vmarkMcp.mjs — resolves the dev profile from it
 * @coordinates-with server/mcp/src/utils/portFile.ts — resolves the release one
 * @module test/devProfileIsolation
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const release = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
  identifier?: unknown;
};
const dev = JSON.parse(readFileSync("src-tauri/tauri.dev.conf.json", "utf8")) as {
  identifier?: unknown;
};

describe("dev profile isolation", () => {
  it("ships a release identifier", () => {
    expect(typeof release.identifier).toBe("string");
    expect(release.identifier).not.toBe("");
  });

  it("gives the dev build an identifier of its own", () => {
    // Absent is the exact state that caused the defect: the merge leaves the
    // release identifier in place, so `tauri dev` IS the installed app.
    expect(
      typeof dev.identifier,
      "tauri.dev.conf.json must declare `identifier`, or `tauri dev` resolves " +
        "app_data_dir()/app_log_dir()/localStorage to the installed app's profile",
    ).toBe("string");
  });

  it("does not reuse the release identifier", () => {
    expect(
      dev.identifier,
      "the dev and release builds would share one hot-exit session and one mcp-port file",
    ).not.toBe(release.identifier);
  });

  it("keeps the dev identifier a strict extension of the release one", () => {
    // Not cosmetic: `cli_install` targets the app by bundle id (`open -b
    // app.vmark`), so the dev id must never be a value that could match the
    // release app's, while still being recognisable as VMark's in a process
    // list or a `~/Library/Application Support` listing.
    expect(dev.identifier).toMatch(/^app\.vmark\.[a-z0-9-]+$/);
  });

  it("is a leaf directory name, so app_data_dir() cannot escape", () => {
    // The identifier becomes a single path SEGMENT. A separator or a traversal
    // in it would put the profile somewhere nobody expects.
    const id = String(dev.identifier);
    expect(id).not.toContain("/");
    expect(id).not.toContain("\\");
    expect(id).not.toContain("..");
  });

  it("overrides nothing else that would make the dev build a different app", () => {
    // The dev config is a narrow override, and it must stay narrow: anything
    // beyond identity and icons means `tauri dev` is exercising a build the
    // release never runs, which is the opposite of what a dev build is for.
    expect(Object.keys(dev).sort()).toEqual(["$schema", "bundle", "identifier"]);
  });

  it("leaves the shipped sidecar defaulting to the RELEASE profile", () => {
    // The sidecar ships inside the app bundle and must find the installed app.
    // Only the e2e harness — which always drives `tauri dev` — looks elsewhere.
    const portFile = readFileSync("server/mcp/src/utils/portFile.ts", "utf8");
    expect(portFile).toContain(`|| '${String(release.identifier)}'`);
    expect(portFile).not.toContain(String(dev.identifier));
  });

  it("has the e2e harness DERIVE the dev profile rather than restate it", () => {
    // A copied literal is a second spelling of the same fact, and two spellings
    // that must agree are what produced this defect in the first place.
    const helper = readFileSync("e2e/lib/vmarkMcp.mjs", "utf8");
    expect(helper).toContain("tauri.dev.conf.json");
    expect(
      helper,
      "e2e must not hardcode an identifier — it reads tauri.dev.conf.json",
    ).not.toContain(`"${String(dev.identifier)}"`);
  });
});
