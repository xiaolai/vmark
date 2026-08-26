/**
 * Global test lifecycle hooks.
 *
 * Two properties every app-tier test gets for free, both of which were
 * previously each file's job to remember — which is the same as saying they
 * were nobody's.
 *
 * Split out of `setup.ts` only because that file sits exactly on the 300-line
 * limit; they belong to the same setup and are imported by it.
 *
 * @coordinates-with src/test/setup.ts — imports this for its side effects
 * @module test/globalTestHooks
 */
import { vi, beforeEach, afterEach } from "vitest";
import { signalMenuCommandsMounted } from "@/services/commands/menuCommandsReady";

// The window-ready handshake waits for the menu listener to mount before it
// tells Rust (and the DOM) that the window is listening — see
// `services/commands/menuCommandsReady.ts`. In the app that signal comes from
// `useCommandBootstrap`, several layers below `WindowProvider`; a test that
// renders the provider with a stand-in child has no such layer, so without
// this it would sit out the whole budget and then log a failure for a mount
// that was never going to happen.
//
// Signalled here rather than per file so the trap cannot be re-sprung by the
// next test that renders a provider. The three suites that are ABOUT the
// handshake call `resetMenuCommandsForTest()` in their own `beforeEach`, which
// runs after this one and therefore wins.
beforeEach(() => {
  signalMenuCommandsMounted();
});

// Real timers are the DEFAULT after every test, not a courtesy each file pays
// on its way out. A file that switches to fake timers inside a test and then
// FAILS before its own `vi.useRealTimers()` used to leak them into whatever
// ran next: those tests never advanced a clock nobody was driving, so they sat
// out the full timeout apiece. One real failure became four, and the three
// extra ones pointed at innocent code. No file establishes fake timers in
// `beforeAll` (checked repo-wide), so resetting here cannot take them away
// from anything that meant to keep them.
afterEach(() => {
  vi.useRealTimers();
});
