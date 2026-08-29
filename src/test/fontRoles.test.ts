// @vitest-environment node
// WI-UI2.1 — two font roles (R3), and honest statics.
/**
 * `--font-ui` is the chrome face (static, never touched by settings);
 * `--font-sans`/`--font-mono` are the READING faces, overwritten at runtime by
 * useTheme. The statics must equal what the runtime writes for the default
 * ("system") settings — the old statics carried "SauceCodePro NF, Courier
 * New", a stack the runtime never produced, so first paint flashed a
 * different mono than every later paint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildFontStack } from "@/utils/fontStacks";

const css = readFileSync("src/styles/index.css", "utf8");
// The @theme bridge ALSO declares --font-sans (mapping Tailwind's utility onto
// --font-ui) — the statics under test live in :root, after that block.
const rootCss = css.slice(css.indexOf(":root {"));

function staticValue(name: string): string {
  const re = new RegExp(`${name}:\\s*([^;]+);`);
  const m = re.exec(rootCss);
  expect(m, name).not.toBeNull();
  return m![1].replace(/\s+/g, " ").trim();
}

describe("font roles (R3)", () => {
  it("--font-ui is declared as a static system stack", () => {
    const ui = staticValue("--font-ui");
    expect(ui.startsWith("system-ui")).toBe(true);
    expect(ui).toContain("PingFang SC"); // CJK chrome labels resolve too
  });

  it("static --font-sans/--font-mono equal the runtime system defaults", () => {
    const runtime = buildFontStack("system", "system", "system", "macos");
    expect(staticValue("--font-sans")).toBe(runtime.sans);
    expect(staticValue("--font-mono")).toBe(runtime.mono);
  });

  it("body is chrome: --font-ui at the chrome base size", () => {
    const body = /body\s*\{([^}]*)\}/.exec(css);
    expect(body).not.toBeNull();
    expect(body![1]).toContain("font-family: var(--font-ui)");
    expect(body![1]).toContain("font-size: var(--font-size-base)");
  });

  it("the catalog's font block mirrors the same three stacks", async () => {
    const { themes } = await import("@/theme/themes");
    const runtime = buildFontStack("system", "system", "system", "macos");
    expect(themes.paper.font.sans).toBe(runtime.sans);
    expect(themes.paper.font.mono).toBe(runtime.mono);
    expect(themes.paper.font.ui).toBe(staticValue("--font-ui"));
  });
});
