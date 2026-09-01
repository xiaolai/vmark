// Pins for the 2026-09-01 UI-audit fixes that are otherwise CSS/wiring-only
// (dev-docs/plans/20260901-ui-audit-fixes.md). One file so the audit's
// contract is auditable in one place; the behavioral WIs are pinned in their
// own suites (tabPillSurface, overlay, StatusBarRight, WelcomeScreen,
// displayFileName, platform).
//
// WI-UA4 — settings panes scroll on the canonical 2px .vm-scroll--thin, not a
//          bespoke zero-width rule that removed the only continuation signal.
// WI-UA5 — light hover/subtle tints retuned to perception (6% / 3–4%), with
//          the static fallbacks and the typed catalog agreeing.
// WI-UA6 — every uppercase micro-label uses the ONE caps tracking token.
// WI-UA7 — the static --primary-color is an alias of --accent-primary, so the
//          two blues cannot drift apart (runtime already emits one value).
// WI-UA9 — dirty-state dots are 6px with an accent halo in BOTH homes (tab
//          pill and title bar), replacing a 5px dot and a text bullet.
// WI-UA14 — REFUTATION pin: the workspace rail's active indicator (::before
//          left bar) and focus indicator (::after bottom bar) are distinct
//          shapes; the audit's "focus and state share one shape" claim was
//          wrong and no consolidation happened.
// WI-UA16 — the rail's full-name tooltip is the native title attribute,
//          already present; the glyph is one grapheme by design.
// WI-UB1 — re-audit 20260901: the elevated (1b) recipe is the .vm-btn BASE,
//          app-wide — the outline-on-grey face is retired everywhere, and
//          the --elevated variant is gone because it became the default.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("ui audit fixes (20260901)", () => {
  it("WI-UA4: settings scroll panes use .vm-scroll--thin; the zero-width rule is gone", () => {
    expect(read("src/pages/Settings.tsx")).toContain("vm-scroll--thin");
    expect(read("src/pages/settings/SettingsNav.tsx")).toContain("vm-scroll--thin");
    // The bespoke opt-out file must stay deleted — width:0 removed the only
    // visible signal that a long panel continues below the fold.
    expect(() => read("src/pages/settings/settings-shell.css")).toThrow();
  });

  it("WI-UA5: hover/subtle statics match the retuned catalog values", () => {
    const css = read("src/styles/index.css");
    expect(css).toContain("--hover-bg: rgba(0, 0, 0, 0.06)");
    expect(css).toContain("--subtle-bg: rgba(0, 0, 0, 0.03)");
    expect(css).toContain("--subtle-bg-hover: rgba(0, 0, 0, 0.04)");
  });

  it("WI-UA5: the typed catalog agrees (one source of truth, two spellings pinned equal)", async () => {
    const { hoverLight, subtleLight } = await import("@/theme/tokens");
    expect(hoverLight.bg).toBe("rgba(0, 0, 0, 0.06)");
    expect(subtleLight.bg).toBe("rgba(0, 0, 0, 0.03)");
    expect(subtleLight.bgHover).toBe("rgba(0, 0, 0, 0.04)");
  });

  it("WI-UA6: no uppercase label speaks a tracking other than --letter-spacing-caps", async () => {
    const { globSync } = await import("node:fs");
    const files = globSync("src/**/*.css");
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const css = read(file);
      for (const body of css.match(/\{[^{}]*\}/g) ?? []) {
        if (body.includes("text-transform: uppercase") && body.includes("letter-spacing:")) {
          expect(body, file).toContain("var(--letter-spacing-caps)");
        }
      }
    }
  });

  it("WI-UA7: the static --primary-color aliases --accent-primary", () => {
    expect(read("src/styles/index.css")).toContain("--primary-color: var(--accent-primary)");
  });

  it("WI-UA9: both dirty dots are 6px accent dots with the soft halo", () => {
    // "\n." anchors the BASE rules — WI-UC1 adds an active-scoped
    // `.tab-pill.active .tab-dirty-dot` flip that would otherwise match first.
    for (const [file, selector] of [
      ["src/components/StatusBar/StatusBar.css", "\n.tab-dirty-dot {"],
      ["src/components/TitleBar/title-bar.css", "\n.dirty-indicator {"],
    ] as const) {
      const css = read(file);
      const i = css.indexOf(selector);
      expect(i, selector).toBeGreaterThan(-1);
      const body = css.slice(i, css.indexOf("}", i));
      expect(body, selector).toContain("width: 6px");
      expect(body, selector).toContain("var(--accent-primary)");
      expect(body, selector).toContain("0 0 0 2px var(--accent-bg)");
    }
    // The title bar renders a styled dot, not a text bullet.
    expect(read("src/components/TitleBar/TitleBar.tsx")).not.toContain(">•<");
  });

  it("WI-UA14 (refuted): rail active (::before left bar) and focus (::after bottom bar) stay distinct shapes", () => {
    const css = read("src/components/WorkspaceRail/WorkspaceRail.css");
    expect(css).toMatch(/\[aria-pressed="true"\]::before/);
    expect(css).toMatch(/:focus-visible::after/);
  });

  it("WI-UA16: the rail item's full name rides the native title tooltip", () => {
    expect(read("src/components/WorkspaceRail/WorkspaceRail.tsx")).toContain("title={displayLabel}");
  });

  it("WI-UB1: the .vm-btn BASE is the elevated recipe — raised face, ink hairline, lift", () => {
    const css = read("src/styles/button-shared.css");
    const i = css.indexOf(".vm-btn {");
    const body = css.slice(i, css.indexOf("}", i));
    expect(body).toContain("background: var(--surface-raised)");
    expect(body).toContain("box-shadow: var(--shadow-sm)");
    expect(body).toContain("color-mix(in srgb, var(--text-color) 8%, transparent)");
    expect(body).not.toContain("var(--bg-secondary)");
    // The variant was promoted into the base and must stay gone — a revived
    // .vm-btn--elevated would mean two spellings of one recipe.
    expect(css).not.toContain(".vm-btn--elevated");
    // The chromeless variant must not inherit the lift.
    const p = css.indexOf(".vm-btn--plain {");
    expect(css.slice(p, css.indexOf("}", p))).toContain("box-shadow: none");
  });
});
