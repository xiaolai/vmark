/**
 * Menu-ID contract rot-proofing (audit 20260612 H1).
 *
 * Re-extracts menu IDs from the REAL Rust menu sources on every test run and
 * diffs them against the checked-in src/shared/menu-ids.json. If a menu item
 * is added/removed in Rust without regenerating the contract (npx tsx
 * scripts/extract-menu-ids.ts), this fails — the contract can never again
 * silently drift the way it did for 4 months after the menu.rs split.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import menuIdsJson from "./menu-ids.json";
import {
  extractMenuIdsFromRust,
  partitionMenuIds,
  EXCLUDED_MENU_IDS,
} from "./menuIdExtraction";

const MENU_DIR = path.resolve(__dirname, "../../src-tauri/src/menu");

function extractFromDisk(): string[] {
  const files = fs
    .readdirSync(MENU_DIR)
    .filter((f) => f.endsWith(".rs"))
    .sort();
  const combined = files
    .map((f) => fs.readFileSync(path.join(MENU_DIR, f), "utf-8"))
    .join("\n");
  return extractMenuIdsFromRust(combined);
}

describe("menu-ids.json contract", () => {
  it("matches the IDs actually declared in src-tauri/src/menu/*.rs", () => {
    const fromRust = extractFromDisk();
    expect(menuIdsJson.allMenuIds).toEqual(fromRust);
  });

  it("menuIds equals allMenuIds minus the curated exclusions", () => {
    const { menuIds } = partitionMenuIds(menuIdsJson.allMenuIds);
    expect(menuIdsJson.menuIds).toEqual(menuIds);
  });

  it("has no ghost exclusions (every excluded ID still exists in Rust)", () => {
    const fromRust = new Set(extractFromDisk());
    const ghosts = [...EXCLUDED_MENU_IDS].filter((id) => !fromRust.has(id));
    expect(ghosts).toEqual([]);
  });
});

describe("extractMenuIdsFromRust", () => {
  it("extracts static with_id declarations", () => {
    const src = `
      let a = MenuItem::with_id(app, "save", label, true, None::<&str>)?;
      let b = MenuItem::with_id(app, "open-folder", label, true, accel)?;
    `;
    expect(extractMenuIdsFromRust(src)).toEqual(["open-folder", "save"]);
  });

  it("skips dynamic placeholder IDs", () => {
    const src = `MenuItem::with_id(app, "recent-file-{n}", label, true, None::<&str>)?;`;
    expect(extractMenuIdsFromRust(src)).toEqual([]);
  });

  it("dedupes repeated IDs", () => {
    const src = `
      MenuItem::with_id(app, "save", a, true, None::<&str>)?;
      MenuItem::with_id(app, "save", b, true, None::<&str>)?;
    `;
    expect(extractMenuIdsFromRust(src)).toEqual(["save"]);
  });
});
