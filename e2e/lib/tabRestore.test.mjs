/**
 * `withTabRestore` teardown: the final tab-bar comparison runs even when the
 * journey itself failed, so a failing journey cannot hide the tab state it
 * leaked or the restoration it could not complete.
 *
 * The client is a stand-in for the automation bridge: it answers the tab-bar
 * snippet `getTabs` evaluates with whatever tabs the test holds.
 *
 * @coordinates-with e2e/lib/vmark.mjs — withTabRestore
 * @module e2e/lib/tabRestore.test
 */
import { describe, it, expect } from "vitest";

import { withTabRestore } from "./vmark.mjs";

/** A bridge client whose every `execute_js` returns the current `tabs`. */
function fakeClient(initial) {
  const state = { tabs: initial, failReads: false };
  return {
    state,
    async send(command) {
      if (command !== "execute_js") throw new Error(`unexpected bridge command ${command}`);
      if (state.failReads) return { success: false, error: "bridge gone" };
      return { success: true, data: structuredClone(state.tabs) };
    },
  };
}

const TAB_A = { id: "a", title: "a.md", selected: true, dirty: false };
const LEAK = { id: "leak", title: "leak.md", selected: false, dirty: false };

describe("withTabRestore", () => {
  it("passes when the journey succeeds and the tab bar is unchanged", async () => {
    const client = fakeClient([TAB_A]);
    await expect(withTabRestore(client, async () => {})).resolves.toBeUndefined();
  });

  it("reports a leak when the journey succeeds", async () => {
    const client = fakeClient([TAB_A]);
    await expect(
      withTabRestore(client, async () => {
        client.state.tabs = [TAB_A, LEAK];
      }),
    ).rejects.toThrow(/journey leaked tab state/);
  });

  it("still reports the leaked tab state when the journey itself failed", async () => {
    const client = fakeClient([TAB_A]);
    const run = withTabRestore(client, async () => {
      client.state.tabs = [TAB_A, LEAK];
      throw new Error("journey assertion failed");
    });
    await expect(run).rejects.toThrow(/journey assertion failed/);
    await expect(run).rejects.toThrow(/journey leaked tab state/);
  });

  it("keeps the journey's own error as the cause", async () => {
    const client = fakeClient([TAB_A]);
    const original = new Error("journey assertion failed");
    const err = await withTabRestore(client, async () => {
      client.state.tabs = [TAB_A, LEAK];
      throw original;
    }).catch((e) => e);
    expect(err.cause).toBe(original);
  });

  it("names a final tab-bar read that failed instead of swallowing it", async () => {
    const client = fakeClient([TAB_A]);
    const run = withTabRestore(client, async () => {
      client.state.failReads = true;
      throw new Error("journey assertion failed");
    });
    await expect(run).rejects.toThrow(/journey assertion failed/);
    await expect(run).rejects.toThrow(/could not read the final tab bar/);
  });

  it("rethrows the journey's error unchanged when teardown found nothing", async () => {
    const client = fakeClient([TAB_A]);
    const original = new Error("journey assertion failed");
    const err = await withTabRestore(client, async () => {
      throw original;
    }).catch((e) => e);
    expect(err).toBe(original);
  });
});
