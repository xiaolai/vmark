/**
 * resourceStack
 *
 * Purpose: A tiny acquire/release stack for multi-step construction that can
 * fail partway (audit fix for createTerminalInstance).
 *
 * Why: building a terminal acquires a DOM container, an xterm instance, an IME
 * gate, a WebGL renderer and several handlers, one at a time — and several of
 * those steps can throw. Hand-written teardown had two problems: a throw
 * mid-construction unwound nothing (leaking the container and the terminal),
 * and the success-path `dispose()` was a second, separately maintained list
 * that could drift from the acquisition order. Registering each release beside
 * its acquisition makes the two the same list, by construction.
 *
 * @coordinates-with createTerminalInstance.ts — sole consumer
 * @module components/Terminal/resourceStack
 */
import { terminalLog } from "@/utils/debug";

export interface ResourceStack {
  /** Register a release for a resource that has just been acquired. */
  acquire: (release: () => void) => void;
  /**
   * Release everything, most recent first (later resources may depend on
   * earlier ones). Safe to call twice — the second call is a no-op. A release
   * that throws is logged and does not stop the rest.
   */
  releaseAll: () => void;
}

/** Create an empty resource stack. */
export function createResourceStack(label: string): ResourceStack {
  const releases: Array<() => void> = [];
  return {
    acquire: (release) => {
      releases.push(release);
    },
    releaseAll: () => {
      // Splice rather than iterate-then-clear so a re-entrant call sees an
      // empty stack and cannot double-release.
      const pending = releases.splice(0, releases.length).reverse();
      for (const release of pending) {
        try {
          release();
        } catch (e) {
          terminalLog(`${label}: release step threw:`, e);
        }
      }
    },
  };
}
