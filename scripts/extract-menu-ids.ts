#!/usr/bin/env npx tsx
/**
 * Regenerates src/shared/menu-ids.json from the Rust menu modules.
 *
 * Usage: npx tsx scripts/extract-menu-ids.ts
 *
 * Reads every src-tauri/src/menu/*.rs file (the menu was split into
 * submodules in 2026-02; audit 20260612 H1 found this script still reading
 * the deleted menu.rs). Extraction and the exclusion list live in
 * src/shared/menuIdExtraction.ts so the contract test can reuse them.
 */

import fs from "node:fs";
import path from "node:path";
import {
  extractMenuIdsFromRust,
  partitionMenuIds,
} from "../src/shared/menuIdExtraction";

const MENU_DIR = path.join(process.cwd(), "src-tauri/src/menu");
const OUTPUT_PATH = path.join(process.cwd(), "src/shared/menu-ids.json");

function main() {
  const rustFiles = fs
    .readdirSync(MENU_DIR)
    .filter((f) => f.endsWith(".rs"))
    .sort();
  if (rustFiles.length === 0) {
    console.error(`No .rs files found in ${MENU_DIR}`);
    process.exit(1);
  }
  console.log(`Extracting menu IDs from ${rustFiles.length} files in ${MENU_DIR}`);

  const combined = rustFiles
    .map((f) => fs.readFileSync(path.join(MENU_DIR, f), "utf-8"))
    .join("\n");
  const allIds = extractMenuIdsFromRust(combined);
  const { menuIds } = partitionMenuIds(allIds);

  const output = {
    // Menu IDs routed through the action registry (MENU_TO_ACTION)
    menuIds,
    // All extracted IDs for reference
    allMenuIds: allIds,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(
    `Generated ${OUTPUT_PATH}: ${allIds.length} total IDs, ${menuIds.length} registry-routed`
  );
}

main();
