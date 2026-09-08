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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evalJs } from "./bridge.mjs";
import { poll } from "./vmark.mjs";
import {
  patchPersistedSettings,
  readPersistedSettingsSection,
} from "./settingsPatch.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULTS_PATH = "src/stores/settingsStore/defaults.ts";

/**
 * The SHIPPED default for `general.workspaceRailMode`, read from the app's own
 * settings source.
 *
 * `withRailMode` has to push a value through the storage event to reset the
 * live store — deleting the persisted key alone never does, because the
 * reconciler deep-merges — and it used to push a hardcoded `false`. That is
 * today's default written down twice: flip `defaults.ts` and every journey
 * restores the WRONG live state, silently, on a machine where nothing is
 * watching (audit R3 #3). Reading the literal keeps one source of truth.
 *
 * It THROWS when the key is gone rather than falling back, because a fallback
 * is the hardcoded default coming back under another name. `source` is an
 * override for the self-test; production callers pass nothing.
 */
export function shippedRailModeDefault(source) {
  const src = source ?? readFileSync(join(REPO, DEFAULTS_PATH), "utf8");
  const m = /^\s*workspaceRailMode:\s*(true|false)\s*,/m.exec(src);
  if (!m) {
    throw new Error(
      `${DEFAULTS_PATH} no longer declares a boolean \`workspaceRailMode\` default — ` +
        "withRailMode cannot restore a setting whose shipped value it cannot read",
    );
  }
  return m[1] === "true";
}

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
 * deleted after, never written back as an explicit value that would shadow
 * a future default change — and the value pushed to reset the LIVE store is
 * read from `defaults.ts` rather than hardcoded. And a restore failure is LOUD (R2-17): when the
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
  let bodyFailed = false;
  try {
    // INSIDE the try: `patchPersistedSettings` writes localStorage and then
    // dispatches the storage event, so a transport failure between the two
    // leaves the setting changed with the `finally` never entered — a journey
    // that silently reconfigures the user's profile (audit R2 #2). Restoration
    // is idempotent (write the prior value back, or delete a key that is
    // already absent), so attempting it after a failed set is safe.
    await setRailMode(client, enabled);
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
        // shipped default through the event, then delete the key so
        // persistence stays presence-faithful. The value is READ from
        // `defaults.ts`, never written here: a literal `false` is the app's
        // default copied into the harness, and a future flip would leave every
        // journey restoring the wrong live state (audit R3 #3).
        await setRailMode(client, shippedRailModeDefault());
        await clearRailMode(client);
      }
    } catch (restoreError) {
      if (!bodyFailed) throw restoreError;
      console.error("withRailMode: failed to restore rail mode after body error:", restoreError);
    }
  }
}

/**
 * The rail's instances as `[{ instanceId, name, active }]`, in rail order.
 * `name` is the entry's display label (its `title`): WorkspaceRail.tsx passes
 * every instance through `disambiguateWorkspaceDisplayNames`, so no two
 * entries share one — which is what lets a menu be matched to its entry, and
 * a re-rooted instance be told from an untouched one (see `restoreRail`).
 */
export async function getRailInstances(client) {
  const raw = await evalJs(
    client,
    `(() => {
       const items = [...document.querySelectorAll('[data-rail-action="activate"]')];
       return JSON.stringify(items.map((el) => ({
         instanceId: el.getAttribute("data-instance-id"),
         name: el.getAttribute("title"),
         active: el.getAttribute("aria-pressed") === "true",
       })));
     })()`,
  );
  const instances = JSON.parse(raw);
  // `data-instance-id` is the automation CONTRACT (WorkspaceRail.test.tsx pins
  // it), and every consumer here treats it as a string: `isPlaceholder` calls
  // `startsWith` on it, `restoreRail` puts it in a Set, `closeRailInstance`
  // selects by it. A missing attribute is `null`, and the first symptom was a
  // bare `TypeError: Cannot read properties of null` from a one-line arrow
  // several calls away (audit R3 #6). Fail at the boundary, naming the entry.
  instances.forEach((entry, index) => {
    if (typeof entry.instanceId !== "string" || entry.instanceId === "") {
      throw new Error(
        `rail entry ${index} (title ${JSON.stringify(entry.name)}) carries no data-instance-id — ` +
          "the rail's automation contract is broken (see WorkspaceRail.tsx / WorkspaceRail.test.tsx)",
      );
    }
  });
  return instances;
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

/** The rail entry's right-click menu (WorkspaceRailContextMenu.tsx). */
const RAIL_MENU = ".workspace-rail-menu[role=menu]";
const railMenuCount = (client) => evalJs(client, `document.querySelectorAll('${RAIL_MENU}').length`);

/**
 * Dismiss any rail context menu that is already open — left behind by an
 * earlier failure, or opened by a concurrent step — so the menu that appears
 * after OUR right-click is the only one. The component dismisses on a
 * mousedown outside itself (WorkspaceRailContextMenu.tsx); a menu that
 * survives that is a defect this helper must not paper over.
 */
async function dismissRailMenus(client) {
  const open = await railMenuCount(client);
  if (open === 0) return;
  await evalJs(client, `(document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), true)`);
  await poll(railMenuCount.bind(null, client), (n) => n === 0, `${open} stale rail context menu(s) to dismiss`);
}

/**
 * Right-click the entry and wait for ITS menu; resolves the entry's name. The
 * menu's `aria-label` is the workspace's display name (WorkspaceRail.tsx passes
 * `menu.name`), the same DISAMBIGUATED string the entry carries as `title` —
 * unique per instance on the rail — so the opened menu is matched to the
 * requested instance rather than to whichever menu happens to exist: exactly
 * one menu, and it is labelled with this entry's name. The click that follows
 * re-checks both in the same evaluation (`clickRailMenuClose`), so a menu
 * swapped in between the wait and the click cannot be the one clicked.
 */
async function openRailMenu(client, instanceId) {
  await dismissRailMenus(client);
  const opened = await evalJs(
    client,
    `(() => {
       const el = document.querySelector('[data-rail-action="activate"][data-instance-id=' + JSON.stringify(${JSON.stringify(instanceId)}) + ']');
       if (!el) return "MISSING";
       const r = el.getBoundingClientRect();
       el.dispatchEvent(new MouseEvent("contextmenu", {
         bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
       }));
       return { name: el.getAttribute("title") };
     })()`,
  );
  if (!opened || typeof opened !== "object") {
    throw new Error(`rail instance ${instanceId} not found to close: ${JSON.stringify(opened)}`);
  }
  await poll(
    () =>
      evalJs(
        client,
        `(() => {
           const menus = [...document.querySelectorAll('${RAIL_MENU}')];
           return {
             menus: menus.length,
             ours: menus.filter((m) => m.getAttribute("aria-label") === ${JSON.stringify(opened.name)}).length,
             items: menus[0] ? menus[0].querySelectorAll('[role=menuitem]').length : 0,
           };
         })()`,
      ),
    (s) => s.menus === 1 && s.ours === 1 && s.items > 0,
    `the rail context menu for ${instanceId} (${opened.name}) to be the one open menu`,
  );
  return opened.name;
}

/**
 * Click Close in the menu labelled `name`, by its stable hook:
 * WorkspaceRailContextMenu.tsx marks every item with `data-menu-action`
 * ("close", "duplicate", "move-to-new-window"), pinned by
 * WorkspaceRailContextMenu.test.tsx. Labels are localized and positions can
 * reorder, so neither is a contract; a menu without the hook is a build this
 * helper does not understand, and it fails loudly instead of guessing at a
 * different action.
 *
 * ATOMIC with its own validation: "exactly one menu, labelled `name`, with the
 * hook" is re-checked and the click dispatched in ONE synchronous evaluation,
 * so there is no round-trip between deciding which menu this is and clicking
 * it — a menu replaced by a concurrent step after `openRailMenu`'s wait is
 * refused here, never closed.
 */
async function clickRailMenuClose(client, name) {
  const outcome = await evalJs(
    client,
    `(() => {
       const menus = [...document.querySelectorAll('${RAIL_MENU}')];
       if (menus.length !== 1) return { via: "menus", menus: menus.length };
       const menu = menus[0];
       const label = menu.getAttribute("aria-label");
       if (label !== ${JSON.stringify(name)}) return { via: "label", label };
       const hook = menu.querySelector('[role=menuitem][data-menu-action="close"]');
       if (!hook) return { via: "no-hook", items: menu.querySelectorAll('[role=menuitem]').length };
       hook.click();
       return { via: "data-menu-action" };
     })()`,
  );
  if (outcome?.via === "menus") {
    throw new Error(`expected exactly one rail context menu (${name}) at the moment of the click, found ${outcome.menus}`);
  }
  if (outcome?.via === "label") {
    throw new Error(`the open rail context menu belongs to ${JSON.stringify(outcome.label)}, not ${JSON.stringify(name)} — not clicked`);
  }
  if (outcome?.via !== "data-menu-action") {
    throw new Error(
      `rail context menu carries no [data-menu-action="close"] item (${outcome?.items ?? "?"} items) — ` +
        "WorkspaceRailContextMenu.tsx marks every item; this build does not, so nothing is clicked",
    );
  }
}

/**
 * Close a rail workspace the way a user does — right-click its entry, choose
 * Close — which runs `closeWorkspaceInstance`: the instance is REMOVED, a
 * successor is promoted and hydrated.
 *
 * History, and why this exists: until 2026-09-07 `menu:close-workspace`
 * (`workspace.close`) only nulled the workspace store's root and left the
 * instance registered and ACTIVE with no root. From then on the status-bar tab
 * strip, scoped to the active instance, had nothing to show and unmounted, and
 * every new untitled tab was claimed into the inactive "Loose Files" —
 * invisible; after journey 17 ran on a rail-on profile, every document-tab
 * journey that followed failed with `scratch tab to appear — last observed:
 * []`. `workspace.close` now takes this same path for the ACTIVE railed
 * workspace (src/services/commands/workspaceCommands.ts). This helper remains
 * the rail's own close for instances the menu close does not reach — a
 * journey's second, non-active workspace — and what `restoreRail` uses.
 *
 * Only for an instance whose tabs the journey controls: a dirty tab in it
 * would raise the native save prompt.
 */
export async function closeRailInstance(client, instanceId) {
  const name = await openRailMenu(client, instanceId);
  await clickRailMenuClose(client, name);
  await poll(
    () => getRailInstances(client),
    (list) => !list.some((i) => i.instanceId === instanceId),
    `rail instance ${instanceId} to be removed`,
    { timeoutMs: 15000 },
  );
}

/**
 * Put the rail back the way a journey found it: close, newest first, every
 * instance that is not in `railBefore`, then re-activate the instance that was
 * active before. Ends by asserting the rail is IDENTICAL to the snapshot — a
 * leaked instance is persisted profile state, not a cosmetic difference, and a
 * ghost left active breaks every document-tab journey after it (see
 * `closeRailInstance`). When the rail is not rendered (rail mode off), both
 * snapshots are empty and this is a no-op.
 *
 * What it can put back is bounded, on purpose: it closes what the journey
 * CREATED and re-activates what was active. It cannot recreate a pre-existing
 * instance the journey closed (its root, tabs and persisted session went with
 * it), nor put back the root of one the journey re-rooted (the display name
 * changed under the same id) — re-opening a workspace here would run the
 * approval flow inside a teardown — nor drag pre-existing entries back into
 * their order (the rail reorders by HTML drag-and-drop, WorkspaceRail.tsx,
 * which no synthetic event reproduces faithfully).
 *
 * Those three are diagnosed against the FINAL rail, not the rail as teardown
 * found it. A rail entry's display name is DISAMBIGUATED against its
 * neighbours (`disambiguateWorkspaceDisplayNames`), so a journey-created
 * workspace sharing a basename renames a PRE-EXISTING neighbour for exactly as
 * long as it is open — which the up-front verdict read as a re-root and
 * reported even though closing the journey's own instances put the name back
 * (audit R2 #4). The failure condition is the identity comparison; the
 * diagnosis only explains it, so it must describe the rail that failed it.
 *
 * Placeholders are never "created" by a journey: the app mints one
 * (`wsi-placeholder-<uuid>`) whenever the rail would otherwise be empty, so
 * one appearing after a close is the app's reaction, not a workspace to close.
 */
export async function restoreRail(client, railBefore) {
  const now = await getRailInstances(client);
  const beforeIds = new Set(railBefore.map((i) => i.instanceId));
  const created = now
    .filter((i) => !beforeIds.has(i.instanceId) && !isPlaceholder(i.instanceId))
    .map((i) => i.instanceId)
    .reverse();
  // EVERY close is attempted, and the failures are collected. Throwing on the
  // first one abandoned the rest of the cleanup — later journey-created
  // instances stayed on the rail, the prior activation was never restored, and
  // the identity comparison that DIAGNOSES all of it never ran (audit R2 #5).
  // A teardown that stops halfway leaks more than one that keeps going.
  const closeFailures = [];
  for (const id of created) {
    try {
      await closeRailInstance(client, id);
    } catch (error) {
      closeFailures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const priorActive = railBefore.find((i) => i.active)?.instanceId ?? null;
  const afterClose = await getRailInstances(client);
  if (priorActive && afterClose.some((i) => i.instanceId === priorActive && !i.active)) {
    try {
      await clickRailInstance(client, priorActive);
      await poll(
        () => getRailInstances(client),
        (list) => list.find((i) => i.instanceId === priorActive)?.active === true,
        "the previously active rail workspace to be active again",
      );
    } catch (error) {
      closeFailures.push(`re-activating ${priorActive}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const final = await getRailInstances(client);
  const identical = JSON.stringify(railIdentity(final)) === JSON.stringify(railIdentity(railBefore));
  if (!identical || closeFailures.length > 0) {
    const unsupported = unsupportedMutations(railBefore, final);
    const why = identical
      ? "the rail matches the snapshot, but cleanup reported failures"
      : unsupported.length > 0
        ? unsupported.join("; ")
        : "order or activation differs from the snapshot";
    const failed = closeFailures.length > 0 ? `\n  cleanup failures: ${closeFailures.join("; ")}` : "";
    throw new Error(
      `rail not restored: ${why}.${failed}\n  before: ${JSON.stringify(railBefore)}\n  after:  ${JSON.stringify(final)}`,
    );
  }
}

const isPlaceholder = (instanceId) => instanceId.startsWith("wsi-placeholder-");

/**
 * Mutations of PRE-EXISTING instances that no teardown can undo, read off a
 * rail: an instance
 * that is gone, one whose display name changed under the same id (a
 * re-rooted or renamed workspace), or the survivors standing in a different
 * relative order (a drag reorder). Placeholders are the app's, not the
 * journey's, and are not diagnosed; instances the journey created sit in
 * between the survivors without disturbing their order.
 */
function unsupportedMutations(railBefore, now) {
  const byId = new Map(now.map((i) => [i.instanceId, i]));
  const beforeIds = new Set(railBefore.map((i) => i.instanceId));
  const out = [];
  for (const b of railBefore) {
    if (isPlaceholder(b.instanceId)) continue;
    const n = byId.get(b.instanceId);
    if (!n) {
      out.push(
        `the journey closed pre-existing rail instance ${b.instanceId} (${b.name ?? "?"}) — restoreRail cannot ` +
          "recreate a workspace it did not open; a journey must only close instances it created",
      );
    } else if (b.name !== undefined && n.name !== b.name) {
      out.push(
        `the journey re-rooted or renamed pre-existing rail instance ${b.instanceId} (${b.name} → ${n.name}) — ` +
          "restoreRail cannot put a workspace's root back; a journey must only mutate instances it created",
      );
    }
  }
  const survivors = railBefore.filter((b) => !isPlaceholder(b.instanceId) && byId.has(b.instanceId)).map((b) => b.instanceId);
  const nowOrder = now.filter((i) => !isPlaceholder(i.instanceId) && beforeIds.has(i.instanceId)).map((i) => i.instanceId);
  if (survivors.join("\n") !== nowOrder.join("\n")) {
    out.push(
      `the journey reordered pre-existing rail instances (${survivors.join(", ")} → ${nowOrder.join(", ")}) — ` +
        "restoreRail cannot drag entries back into place; a journey must only reorder instances it created",
    );
  }
  return out;
}

/**
 * The rail up to placeholder identity. A fresh profile's rail holds ONE
 * placeholder instance (`wsi-placeholder-<uuid>`), which the app deletes the
 * moment a real workspace joins and re-creates under a NEW id when the rail
 * empties again (finalizeInstanceRemoval → ensurePlaceholderInstance). Two
 * placeholders are therefore the same rail state — comparing their ids failed
 * the teardown on exactly the profile CI boots into, after a green body. The
 * display name is part of the identity: same id, different name is a
 * re-rooted workspace, not the one the journey found.
 */
function railIdentity(instances) {
  return instances.map((i) => ({
    instanceId: isPlaceholder(i.instanceId) ? "wsi-placeholder-*" : i.instanceId,
    name: isPlaceholder(i.instanceId) ? "wsi-placeholder-*" : i.name,
    active: i.active,
  }));
}
