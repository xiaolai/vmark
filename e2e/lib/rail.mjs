/**
 * Workspace-rail E2E helpers (WI-TS5.1).
 *
 * HOW THE SETTING IS CHANGED: by writing `vmark-settings` and dispatching a
 * `storage` event — the app's OWN cross-window settings mechanism
 * (`useSettingsSync.ts`), the same pattern browser.mjs uses. Verified to
 * rehydrate `general.*` into the live store without a reload.
 *
 * Rail clicks go through stable `data-rail-action` / `data-instance-id`
 * attributes — aria-labels are localized, so selecting by them breaks under
 * any non-English locale. The attribute values are an automation CONTRACT
 * pinned by WorkspaceRail.test.tsx.
 *
 * @coordinates-with src/hooks/useSettingsSync.ts — the storage-event listener
 * @coordinates-with src/components/WorkspaceRail/WorkspaceRail.tsx — the hooks
 */

import { evalJs } from "./bridge.mjs";
import {
  patchPersistedSettings,
  readPersistedSettingsSection,
} from "./settingsPatch.mjs";

/** The persisted `general.workspaceRailMode`, or null when unset. */
export async function readRailMode(client) {
  const general = await readPersistedSettingsSection(client, "general");
  return general?.workspaceRailMode ?? null;
}

/** Set `general.workspaceRailMode` and notify the running app. */
export async function setRailMode(client, enabled) {
  await patchPersistedSettings(client, "general", { workspaceRailMode: enabled });
}

/** Remove the persisted `general.workspaceRailMode` key entirely (R2-16). */
export async function clearRailMode(client) {
  await patchPersistedSettings(client, "general", {}, { deleteKeys: ["workspaceRailMode"] });
}

/**
 * Run `fn` with the rail forced on/off, restoring the prior state in a
 * `finally` — a journey that leaves the rail flipped has silently changed
 * the user's configuration.
 *
 * Restore is PRESENCE-faithful (R2-16): a key that was absent before is
 * deleted after, never written back as an explicit `false` that would shadow
 * a future default change. And a restore failure is LOUD (R2-17): when the
 * journey body succeeded, the error propagates and fails the journey — a
 * swallowed one leaves the dev profile flipped, which round 1's journey
 * re-verification hit live. When the body itself failed, the body's error
 * stays primary and the restore failure is logged.
 */
export async function withRailMode(client, enabled, fn) {
  const general = await readPersistedSettingsSection(client, "general");
  const hadKey = Boolean(
    general && Object.prototype.hasOwnProperty.call(general, "workspaceRailMode"),
  );
  const prior = general?.workspaceRailMode;
  await setRailMode(client, enabled);
  let bodyFailed = false;
  try {
    return await fn();
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    try {
      if (hadKey) {
        await setRailMode(client, prior);
      } else {
        // The storage-event reconciler DEEP-MERGES, so deleting the persisted
        // key alone never resets the LIVE store (R3-9) — first push the
        // shipped default through the event (the same `false` the pre-R2-16
        // restore encoded), then delete the key so persistence stays
        // presence-faithful.
        await setRailMode(client, false);
        await clearRailMode(client);
      }
    } catch (restoreError) {
      if (!bodyFailed) throw restoreError;
      console.error("withRailMode: failed to restore rail mode after body error:", restoreError);
    }
  }
}

/** The rail's instances as `[{ instanceId, active }]`, in rail order. */
export async function getRailInstances(client) {
  const raw = await evalJs(
    client,
    `(() => {
       const items = [...document.querySelectorAll('[data-rail-action="activate"]')];
       return JSON.stringify(items.map((el) => ({
         instanceId: el.getAttribute("data-instance-id"),
         active: el.getAttribute("aria-pressed") === "true",
       })));
     })()`,
  );
  return JSON.parse(raw);
}

/** Click a rail workspace by instance id (the full context switch). */
export async function clickRailInstance(client, instanceId) {
  const ok = await evalJs(
    client,
    `(() => {
       const el = document.querySelector('[data-rail-action="activate"][data-instance-id=' + JSON.stringify(${JSON.stringify(instanceId)}) + ']');
       if (!el) return "MISSING";
       el.click();
       return true;
     })()`,
  );
  if (ok !== true) throw new Error(`rail instance ${instanceId} not clickable: ${ok}`);
}
