/**
 * Test helper — yield real turns of the event loop until a condition holds,
 * for tests that wait on work they cannot await (a request coordinator's
 * next attempt, a reply bound by a real SHA-256 digest).
 *
 * Key decisions:
 *   - No bound of its own. A turn count measures the machine: the wire's
 *     digests run on the threadpool and a busy run outlasts any fixed number
 *     of turns. A condition that never holds is a hang, and the tier's
 *     liveness timeout (`LIVENESS_TIMEOUT_MS`) reports it.
 *   - `setImmediate` comes from `node:timers`, which fake timers do not
 *     patch, so the helper also works under them, in any environment.
 *
 * @coordinates-with vitest.shared.ts — LIVENESS_TIMEOUT_MS
 * @module test/untilReady
 */

import { setImmediate } from "node:timers";

/** Resolves once `ready()` holds, yielding a macrotask between checks. */
export async function untilReady(ready: () => boolean): Promise<void> {
  while (!ready()) await new Promise((r) => setImmediate(r));
}
