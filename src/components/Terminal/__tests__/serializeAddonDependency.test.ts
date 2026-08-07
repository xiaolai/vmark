// @vitest-environment node
// WI-3.6 — `@xterm/addon-serialize` is present but deliberately UNWIRED.
//
// It is the enabler for scrollback/session persistence (T14), which is
// deferred to its own plan: persisting scrollback touches the versioned
// hot-exit session schema, needs a size-cap policy, and raises a real
// secrets-at-rest question (an API key echoed into a terminal would land on
// disk). Adding the dependency now lets that plan start with a spike instead
// of a dependency debate.
//
// An unused dependency is a liability, so this file is the tracking mechanism
// knip.json cannot be (it is strict JSON — no comments). It pins three things:
// the dependency exists, it is exact-pinned, and its knip exemption is present.
// When the persistence plan lands, wire the addon and DELETE both the knip
// entry and this file. If that plan is abandoned, drop the dependency and this
// file together — either way, the exemption cannot quietly outlive its reason.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../../../../package.json";
import knip from "../../../../knip.json";

const DEP = "@xterm/addon-serialize";

const dependencies = pkg.dependencies as Record<string, string>;
const rootIgnored = (knip.workspaces["."] as { ignoreDependencies: string[] })
  .ignoreDependencies;

const SELF = basename(fileURLToPath(import.meta.url));
/** The `src/` tree — three levels up from src/components/Terminal/__tests__/. */
const SRC_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

describe("@xterm/addon-serialize dependency (WI-3.6)", () => {
  it("is declared as a runtime dependency", () => {
    expect(dependencies[DEP]).toBeDefined();
  });

  it("is exact-pinned, not caret-ranged", () => {
    // An unused dependency should not drift underneath us: nothing imports it,
    // so no test would notice a breaking change until the persistence plan
    // starts and blames the wrong thing.
    expect(dependencies[DEP]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is exempted from knip, since nothing imports it yet", () => {
    expect(rootIgnored).toContain(DEP);
  });

  it("stays unwired — no source file imports it", () => {
    // If this starts failing, the persistence work has begun: remove the knip
    // exemption and delete this file.
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && entry.name !== SELF) {
          if (readFileSync(full, "utf8").includes(DEP)) importers.push(full);
        }
      }
    };
    walk(SRC_ROOT);
    expect(importers).toEqual([]);
  });

  it("keeps its sibling clipboard addon WIRED, by contrast", () => {
    // Guards against the two pinned addons being confused for each other:
    // addon-clipboard IS used (WI-3.5) and must never be knip-exempted.
    expect(dependencies["@xterm/addon-clipboard"]).toBeDefined();
    expect(rootIgnored).not.toContain("@xterm/addon-clipboard");
  });
});
