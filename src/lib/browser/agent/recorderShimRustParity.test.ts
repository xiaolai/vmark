// @vitest-environment node
// The recorder shim is assembled twice — by `recorderShim.ts` for the tests and by
// `recorder_shim_macos.rs` for the page — from the same asset files in the same
// order. Nothing else joins the two: when `agentCore.src.js` was split in two, Rust
// kept injecting only the first half, and the shim would have thrown on its first
// role lookup while every jsdom test stayed green. This reads both sides.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECORDER_SHIM_ASSETS, RECORDER_SHIM_SRC } from "./recorderShim";

const RUST = new URL("../../../../src-tauri/src/browser/recorder_shim_macos.rs", import.meta.url);
const HERE = new URL("./", import.meta.url);

describe("recorder shim assembly parity (Rust ↔ TS)", () => {
  const rust = readFileSync(RUST, "utf8");
  const includes = [...rust.matchAll(/include_str!\("[^"]*\/([^"/]+\.src\.js)"\)/g)].map((m) => m[1]);

  it("Rust include_str!s exactly the TS asset list, in order", () => {
    expect(includes).toEqual([...RECORDER_SHIM_ASSETS]);
  });

  it("the TS string is the same concatenation of the same files", () => {
    const parts = RECORDER_SHIM_ASSETS.map((name) => readFileSync(new URL(name, HERE), "utf8"));
    expect(RECORDER_SHIM_SRC).toBe(`(function(){\n${parts.join("\n")}\n})();`);
  });

  it("every asset the shim body relies on is defined somewhere in the assembled string", () => {
    for (const helper of ["__vmarkKnownRole", "__vmarkFocusable", "__vmarkEditingHost", "sensitiveIdentifier", "isSensitiveNow"]) {
      expect(RECORDER_SHIM_SRC).toMatch(new RegExp(`function ${helper}\\(`));
    }
  });
});
