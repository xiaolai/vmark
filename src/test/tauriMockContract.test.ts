// @vitest-environment node
/**
 * Purpose: every async Tauri API mocked in `setup.ts` must return a PROMISE.
 *
 * This is the assertion half of a fix. A bare `vi.fn()` returns `undefined`,
 * and `undefined` is a uniquely bad stand-in for a promise because it fails
 * SILENTLY in the direction that matters: `await undefined` is legal and
 * yields `undefined`, so production code with a MISSING `await` behaves
 * identically to correct code under test. The bug ships; the suite stays green.
 * Only the reverse case is loud — a real `.then()/.catch()` chain throws — and
 * that is the case tests rarely take.
 *
 * The project had already found this once and fixed it for `invoke` alone,
 * leaving a comment explaining the exact mechanism while seven `plugin-fs`
 * functions, five `plugin-dialog` functions and three `emit`/`close` methods
 * kept the defect. A comment is not a guard. This is.
 *
 * Scope note: only genuinely async APIs belong here. `@/lib/pty`'s `IPty`
 * methods (`write`, `resize`, `kill`, …) and xterm's are declared `: void` in
 * their real types, so a bare `vi.fn()` is CORRECT for them and adding them
 * would assert a falsehood.
 *
 * @coordinates-with src/test/setup.ts — the mocks this pins
 * @module test/tauriMockContract
 */
import { describe, expect, it } from "vitest";
import * as fs from "@tauri-apps/plugin-fs";
import * as dialog from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { basename, dirname, join } from "@tauri-apps/api/path";
import { posix } from "node:path";

/** `x` is thenable — the only property `await` and `.then()` both depend on. */
function isThenable(x: unknown): boolean {
  return typeof (x as { then?: unknown } | null | undefined)?.then === "function";
}

describe("mocked async Tauri APIs return promises", () => {
  it.each([
    ["fs.readTextFile", () => fs.readTextFile("/x")],
    ["fs.writeTextFile", () => fs.writeTextFile("/x", "y")],
    ["fs.exists", () => fs.exists("/x")],
    ["fs.mkdir", () => fs.mkdir("/x")],
    ["fs.readDir", () => fs.readDir("/x")],
    ["fs.remove", () => fs.remove("/x")],
    ["fs.rename", () => fs.rename("/x", "/y")],
    ["dialog.open", () => dialog.open()],
    ["dialog.save", () => dialog.save()],
    ["dialog.message", () => dialog.message("m")],
    ["dialog.ask", () => dialog.ask("q")],
    ["dialog.confirm", () => dialog.confirm("q")],
    ["core.invoke", () => invoke("cmd")],
    ["event.emit", () => emit("evt")],
    ["event.listen", () => listen("evt", () => {})],
  ])("%s returns a thenable", (_name, call) => {
    expect(isThenable(call())).toBe(true);
  });

  it("webviewWindow emit/close return thenables", () => {
    const win = getCurrentWebviewWindow();
    expect(isThenable(win.emit("evt"))).toBe(true);
    expect(isThenable(win.close())).toBe(true);
  });

  it("resolved values are the EMPTY CASE of the real return type, not undefined", async () => {
    // `undefined` here would make `(await readDir(p)).map(...)` throw in any
    // test that did not stub it — which pushes every caller into stubbing, and
    // a stub that is always overridden guards nothing.
    await expect(fs.readTextFile("/x")).resolves.toBe("");
    await expect(fs.readDir("/x")).resolves.toEqual([]);
    await expect(fs.exists("/x")).resolves.toBe(false);
    // Cancel is the honest default for an un-stubbed dialog: a test that has
    // not decided what the user picked has not picked a file.
    await expect(dialog.open()).resolves.toBeNull();
    await expect(dialog.save()).resolves.toBeNull();
    await expect(dialog.confirm("q")).resolves.toBe(false);
  });
});

describe("the mocked path API has real path semantics", () => {
  // Every case below is one the previous naive implementation got WRONG, and
  // each is an input that path-safety code specifically exists to handle. A
  // traversal or trailing-slash guard tested against `parts.join("/")` is
  // tested against a normalization the app never receives.
  it.each([
    // [parts, expected, what the naive `parts.join("/")` produced]
    [["a/", "b"], "a/b", "a//b"],
    [["a", "../b"], "b", "a/../b"],
    [["/root", "x", "y"], "/root/x/y", "/root/x/y"],
    [["a", ""], "a", "a/"],
    [["a", ".", "b"], "a/b", "a/./b"],
  ])("join(%j) === %s", async (parts, expected) => {
    await expect(join(...(parts as string[]))).resolves.toBe(expected);
  });

  it.each([
    ["/a/b/c", "/a/b"],
    ["/a/b/", "/a"], // naive gave "/a/b" — a trailing slash shifted the answer
    ["/a", "/"],
    ["/", "/"],
  ])("dirname(%s) === %s", async (input, expected) => {
    await expect(dirname(input)).resolves.toBe(expected);
  });

  it.each([
    ["/a/b/c", "c"],
    ["/a/b/", "b"], // naive gave "" — the empty last segment
    ["/", ""],
    ["file.md", "file.md"],
  ])("basename(%s) === %s", async (input, expected) => {
    await expect(basename(input)).resolves.toBe(expected);
  });

  it("agrees with node:path posix, which is the model it claims to be", async () => {
    // Not a tautology against the implementation: it pins the CHOICE of model.
    // Swapping back to a hand-rolled approximation fails here even if every
    // case above were also hand-updated to match it.
    for (const p of ["/a/b/", "/a", "/", "a/b/c.md", "/x/../y"]) {
      await expect(dirname(p)).resolves.toBe(posix.dirname(p));
      await expect(basename(p)).resolves.toBe(posix.basename(p));
    }
  });
});
