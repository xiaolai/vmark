// WI-SOC.1 — every app-level overlay must declare an occlusion policy.
//
// This is the gate itself, and it is deliberately not a hand-checked list. The plan's
// first occluder inventory WAS a hand-written table, and the cross-model review found
// a missing entry (ContentSearch) on its first read. A list is a snapshot of one day's
// App.tsx; the danger is precisely the overlay nobody remembered. So this test reads
// App.tsx, extracts what is actually rendered in the overlay slot, and fails if any of
// it has no declared policy.
//
// If you are here because this test failed: you added an overlay. Decide what it does
// about the browser (freeze it, or prove it cannot overlap the browser rect) and say
// so in OVERLAY_POLICIES. Do not delete the assertion.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { OVERLAY_POLICIES } from "./overlayPolicies";
/** Component names rendered in App.tsx.
 *
 *  Matches ANY PascalCase JSX element, with or without props. An earlier version of
 *  this only matched the self-closing `<X />` shape and therefore silently skipped
 *  `<QuickOpen windowLabel={...} />` and `<ContentSearch windowLabel={...} />` — the
 *  very overlay the review caught us missing. A gate that cannot see a thing reports
 *  success about it, which is worse than having no gate. */
function overlaysRenderedInApp(): string[] {
  const src = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const names = new Set<string>();
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g)) names.add(m[1]);
  return [...names];
}

/** Overlays are the ones we care about; App also renders plain structural components.
 *  Anything ending in these suffixes, or explicitly known, is treated as an overlay. */
const OVERLAY_SUFFIXES = ["Overlay", "Dialog", "Palette", "Picker", "Menu", "Search"];
function isOverlay(name: string): boolean {
  return OVERLAY_SUFFIXES.some((s) => name.endsWith(s)) || name === "QuickOpen";
}

describe("overlay occlusion registry", () => {
  it("every overlay rendered in App.tsx declares an occlusion policy", () => {
    const undeclared = overlaysRenderedInApp()
      .filter(isOverlay)
      .filter((name) => !(name in OVERLAY_POLICIES));
    // (The registry may hold MORE than App.tsx renders — surfaces that open upward out
    // of the bottom bar live in the StatusBar, not the app overlay slot. This assertion
    // is one-directional: everything App renders must be declared.)

    expect(
      undeclared,
      `These overlays are rendered in App.tsx but declare no occlusion policy. The ` +
        `native browser view paints over ALL React DOM in its rect, so an overlay ` +
        `without a policy can be painted over by a live web page. Add each to ` +
        `OVERLAY_POLICIES in overlayOcclusion.ts.`,
    ).toEqual([]);
  });

  it("a no-overlap policy must justify itself", () => {
    for (const [name, policy] of Object.entries(OVERLAY_POLICIES)) {
      if (policy.kind === "no-overlap") {
        expect(policy.because.length, `${name} claims no-overlap without saying why`)
          .toBeGreaterThan(20);
      }
    }
  });

  // Declaring a policy is not the same as honouring it. An overlay could sit in the
  // registry marked `freeze` and never call the hook — and the registry test above
  // would happily pass while a live web page painted over it. So: if you say you
  // freeze, the source must actually freeze.
  it("every overlay that declares `freeze` actually calls useBrowserOccluder", () => {
    const sourceOf = (name: string): string | null => {
      // BrowserApprovalDialog drives browserOcclusion directly (it freezes the ONE tab
      // the request targets, not every mounted browser), so it is exempt by design.
      if (name === "BrowserApprovalDialog") return null;
      // DropOverlay is defined inline in App.tsx.
      const candidates =
        name === "DropOverlay"
          ? ["src/App.tsx"]
          : globSyncish(name);
      for (const c of candidates) {
        try {
          return readFileSync(resolve(process.cwd(), c), "utf8");
        } catch {
          /* try the next candidate */
        }
      }
      throw new Error(`could not locate the source for overlay "${name}"`);
    };

    const notWired = Object.entries(OVERLAY_POLICIES)
      .filter(([, p]) => p.kind === "freeze")
      .filter(([name]) => {
        const src = sourceOf(name);
        return src !== null && !src.includes("useBrowserOccluder");
      })
      .map(([name]) => name);

    expect(
      notWired,
      `These overlays declare a "freeze" policy but never call useBrowserOccluder, so ` +
        `the native browser view will paint straight over them. Wire the hook.`,
    ).toEqual([]);
  });
});

/** Where an overlay component's source is likely to live. */
function globSyncish(name: string): string[] {
  const known: Record<string, string> = {
    CommandPalette: "src/components/CommandPalette/CommandPalette.tsx",
    QuickOpen: "src/components/QuickOpen/QuickOpen.tsx",
    ContentSearch: "src/components/ContentSearch/ContentSearch.tsx",
    GeniePickerOverlay: "src/components/GeniePicker/GeniePickerOverlay.tsx",
    QuickLookOverlay: "src/components/QuickLook/QuickLookOverlay.tsx",
    KnowledgeBaseOverlay: "src/components/KnowledgeBasePanel/KnowledgeBaseOverlay.tsx",
    WindowStatusOverlay: "src/components/WindowStatusPanel/WindowStatusOverlay.tsx",
    ApprovalDialog: "src/components/WorkflowApproval/ApprovalDialog.tsx",
    TabContextMenu: "src/components/Tabs/TabContextMenu.tsx",
    WordCountPopover: "src/components/StatusBar/WordCountPopover.tsx",
  };
  const hit = known[name];
  if (!hit) throw new Error(`overlay "${name}" has no known source path — add it here`);
  return [hit];
}
