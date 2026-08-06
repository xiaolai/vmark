/**
 * Adapter action vocabulary parity (WI-4).
 *
 * Extracts the REAL `case "…"` labels from both adapter switches and fails
 * when they and `ADAPTER_ACTION_IDS` drift in either direction — a renamed
 * or removed switch arm breaks this test, and a union entry no adapter
 * routes breaks it too. Consumer definitions (toolbarGroups, menu model) are
 * typed against the union, so their side of the contract is a compile error
 * instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTER_ACTION_IDS, isAdapterAction } from "../adapterActions";
import { TOOLBAR_GROUPS, isSeparator } from "@/components/Editor/UniversalToolbar/toolbarGroups";

const ROOT = process.cwd();

function caseLabels(relPath: string): Set<string> {
  const source = readFileSync(join(ROOT, relPath), "utf8");
  const labels = new Set<string>();
  for (const match of source.matchAll(/case "([^"]+)":/g)) labels.add(match[1]);
  return labels;
}

describe("adapter action parity", () => {
  const wysiwyg = caseLabels("src/plugins/toolbarActions/wysiwygAdapter.ts");
  const source = caseLabels("src/plugins/toolbarActions/sourceAdapter.ts");
  const routed = new Set([...wysiwyg, ...source]);

  it("every switch case is a declared adapter action", () => {
    const undeclared = [...routed].filter((label) => !isAdapterAction(label));
    expect(undeclared).toEqual([]);
  });

  it("every declared action is routed by at least one adapter", () => {
    const unrouted = ADAPTER_ACTION_IDS.filter((id) => !routed.has(id));
    expect(unrouted).toEqual([]);
  });

  it("documents the per-surface exclusives explicitly", () => {
    const sourceOnly = [...source].filter((label) => !wysiwyg.has(label)).sort();
    const wysiwygOnly = [...wysiwyg].filter((label) => !source.has(label)).sort();
    expect(sourceOnly).toEqual(["sortLinesAsc", "sortLinesDesc"]);
    expect(wysiwygOnly).toEqual(["toggleQuoteStyle"]);
  });

  it("every toolbar item action is declared (runtime mirror of the compile check)", () => {
    for (const group of TOOLBAR_GROUPS) {
      for (const item of group.items) {
        if (isSeparator(item)) continue;
        expect(isAdapterAction(item.action), `${item.id} → ${item.action}`).toBe(true);
      }
    }
  });

  it("the boundary guard accepts heading levels 0-6 and rejects garbage", () => {
    expect(isAdapterAction("heading:0")).toBe(true);
    expect(isAdapterAction("heading:6")).toBe(true);
    expect(isAdapterAction("heading:7")).toBe(false);
    expect(isAdapterAction("boldd")).toBe(false);
    expect(isAdapterAction("")).toBe(false);
  });
});
