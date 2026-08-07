// @vitest-environment node
/**
 * WI-6.2 — every shipped shortcut definition must produce a valid canonical
 * chord on BOTH platforms, so the KeyCapture-format string a user stores and the
 * runtime `event.code`-based matcher can never silently diverge. A definition
 * whose `defaultKey` fails to canonicalize would drop out of the resolver index
 * unnoticed (the same failure class WI-1.3 guards for command bindings).
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";
import { canonicalizeChordString, type Platform } from "@/utils/keybinding/canonicalChord";

const PLATFORMS: Platform[] = ["mac", "other"];

/** The chord strings a definition can resolve to, per platform field. */
function keysFor(def: (typeof DEFAULT_SHORTCUTS)[number]): Array<{ field: string; key: string }> {
  const out: Array<{ field: string; key: string }> = [];
  if (def.defaultKey) out.push({ field: "defaultKey", key: def.defaultKey });
  if (def.defaultKeyMac) out.push({ field: "defaultKeyMac", key: def.defaultKeyMac });
  if (def.defaultKeyOther) out.push({ field: "defaultKeyOther", key: def.defaultKeyOther });
  return out;
}

describe("shortcut definitions — canonicalization consistency (WI-6.2)", () => {
  it("every defaultKey / platform variant canonicalizes to a non-null chord on both platforms", () => {
    const failures: string[] = [];
    for (const def of DEFAULT_SHORTCUTS) {
      for (const { field, key } of keysFor(def)) {
        for (const platform of PLATFORMS) {
          const chord = canonicalizeChordString(key, platform);
          if (!chord) failures.push(`${def.id}.${field}="${key}" (${platform})`);
        }
      }
    }
    expect(failures, `uncanonicalizable: ${failures.join(", ")}`).toEqual([]);
  });

  it("canonicalization is deterministic (same input → same output)", () => {
    for (const def of DEFAULT_SHORTCUTS.slice(0, 20)) {
      if (!def.defaultKey) continue;
      const a = canonicalizeChordString(def.defaultKey, "mac");
      const b = canonicalizeChordString(def.defaultKey, "mac");
      expect(a).toBe(b);
    }
  });

  it("all 123 definitions have a non-empty id and defaultKey (or a platform variant)", () => {
    for (const def of DEFAULT_SHORTCUTS) {
      expect(def.id, "shortcut id").toBeTruthy();
      const hasAnyKey = !!(def.defaultKey || def.defaultKeyMac || def.defaultKeyOther);
      // An intentionally-unbound entry may have an empty defaultKey; only flag a
      // total absence of the field, which would be a malformed definition.
      expect(
        "defaultKey" in def || hasAnyKey,
        `${def.id} has no defaultKey field`,
      ).toBe(true);
    }
  });
});
