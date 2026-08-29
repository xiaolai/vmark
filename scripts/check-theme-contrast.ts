#!/usr/bin/env node
// WI-UI0.1 — the catalog contrast gate (C1a–C1f; rules R1, D10, D11).
/**
 * Measures every colour token in the typed theme catalog against every
 * background the theme actually puts it on, per `dev-docs/plans/
 * 20260829-ui-consistency.md` §"The gate". The catalog is IMPORTED, not
 * parsed: `semantic: semanticLight` / `...sharedPrimitives` mean a text
 * parser sees no literal for half of each theme.
 *
 * What is measured, per theme (pair ids in parentheses):
 *   C1a  text-capable tokens ≥ 4.5 on bg.primary, bg.secondary and the
 *        EMITTED --bg-tertiary (`text.secondary/bg.primary`); the emitted
 *        codeText on bg.secondary (`codeText/bg.secondary`). "Emitted" means
 *        computed through the SAME adapter + legacy-writer projection the
 *        runtime uses, so Phase-1 emission fixes move this gate automatically.
 *   C1b  boundary/icon tokens ≥ 3.0 on bg.primary/bg.secondary: media.*,
 *        decorative text.tertiary (D3), the emitted mdChar (syntax markers,
 *        WI-UI1.3), and controlBorder once the catalog carries it (D8).
 *   C1c  text.primary over blend(accent.bg), text.primary over
 *        blend(selection) — rgba COMPOSITED over bg.primary first — and the
 *        emitted contrastText over accent.primary, all ≥ 4.5.
 *   C1d  ANSI slots as foreground vs bg.primary ≥ 4.5 unless a per-theme
 *        `ansiFloor` (reason REQUIRED); bright≠normal max-channel Δ ≥ 15
 *        (`ansi.brightRed≈red`) unless exempted; a bright slot that equals a
 *        text tier requires `terminal.boldTextInBrightColors: false`
 *        (`terminal.boldTextInBrightColors`). The floors assume xterm's
 *        minimumContrastRatio lift, so the default is pinned ≥ 4.5 here too.
 *   C1e  syntax.* ≥ 4.5 on bg.primary AND bg.secondary — self-activates when
 *        a theme carries a `syntax` block (WI-UI1.5).
 *   C1f  bg.secondary ≥ 1.15:1 from bg.primary (`surface-ramp/bg.secondary`,
 *        open question Q1).
 *
 * Baseline: scripts/theme-contrast-baseline.json — identity per theme
 * (`failing`), onAdd: fail; `ansiFloor`/`exempt` carry REQUIRED reasons.
 * A failing pair not in the baseline exits 1; a baselined pair that now
 * passes exits 1 (record the win); `--update` rewrites the failing lists.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ThemeTokens } from "../src/theme/tokens";
import { themeTokensToColors } from "../src/theme/themeColorsAdapter";
import { computeCoreColorVars, computeModeColorVars } from "../src/theme/legacyModeColors";

type RGBA = [number, number, number, number];
type RGB = [number, number, number];

export function parseColor(raw: string): RGBA {
  const s = raw.trim().toLowerCase();
  if (s === "white") return [255, 255, 255, 1];
  if (s === "black") return [0, 0, 0, 1];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`unparseable colour "${raw}"`);
}

export function compositeOver(fg: RGBA, bg: RGBA): RGB {
  const a = fg[3];
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as unknown as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastFinding {
  theme: string;
  id: string;
  ratio: number;
  needed: number;
  message: string;
}

export interface ContrastBaseline {
  failing?: Record<string, string[]>;
  ansiFloor?: Record<string, { value: number; reason?: string }>;
  exempt?: Record<string, { id: string; reason?: string }[]>;
}

/** Token paths measured at the 4.5 text floor (C1a). */
const TEXT_TOKENS: [string, (t: ThemeTokens) => string][] = [
  ["text.primary", (t) => t.color.text.primary],
  ["text.secondary", (t) => t.color.text.secondary],
  ["accent.primary", (t) => t.color.accent.primary],
  ["strong", (t) => t.color.strong],
  ["emphasis", (t) => t.color.emphasis],
  ["semantic.error", (t) => t.color.semantic.error],
  ["semantic.errorHover", (t) => t.color.semantic.errorHover],
  ["semantic.warning", (t) => t.color.semantic.warning],
  ["semantic.success", (t) => t.color.semantic.success],
  ["semantic.successHover", (t) => t.color.semantic.successHover],
  ["alert.note", (t) => t.color.alert.note],
  ["alert.tip", (t) => t.color.alert.tip],
  ["alert.important", (t) => t.color.alert.important],
  ["alert.warning", (t) => t.color.alert.warning],
  ["alert.caution", (t) => t.color.alert.caution],
];

/** Token paths measured at the 3.0 boundary/icon floor (C1b). */
const BOUNDARY_TOKENS: [string, (t: ThemeTokens) => string | undefined][] = [
  ["media.video", (t) => t.color.media.video],
  ["media.audio", (t) => t.color.media.audio],
  ["media.youtube", (t) => t.color.media.youtube],
  ["media.vimeo", (t) => t.color.media.vimeo],
  ["media.bilibili", (t) => t.color.media.bilibili],
  ["text.tertiary", (t) => t.color.text.tertiary],
  ["controlBorder", (t) => (t.color as { controlBorder?: string }).controlBorder],
];

const BRIGHT_PAIRS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

function normHex(c: string): string {
  const [r, g, b] = parseColor(c);
  return `${r},${g},${b}`;
}

export function contrastFindings(
  themes: Record<string, ThemeTokens>,
  baseline: ContrastBaseline,
): { findings: ContrastFinding[]; problems: string[] } {
  const findings: ContrastFinding[] = [];
  const problems: string[] = [];

  for (const [id, entry] of Object.entries(baseline.ansiFloor ?? {})) {
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      problems.push(`ansiFloor.${id} has no reason — a floor without a stated reason is a mute button.`);
    }
  }
  for (const [id, entries] of Object.entries(baseline.exempt ?? {})) {
    for (const e of entries) {
      if (typeof e.reason !== "string" || e.reason.trim() === "") {
        problems.push(`exempt ${id}/${e.id} has no reason — state why, or delete it.`);
      }
    }
  }

  for (const [themeId, t] of Object.entries(themes)) {
    const raw: ContrastFinding[] = [];
    const colors = themeTokensToColors(t);
    const vars: Record<string, string> = {
      ...computeCoreColorVars(colors),
      ...computeModeColorVars(colors, t.isDark).vars,
    };
    const bgPrimary = compositeOver(parseColor(t.color.bg.primary), [255, 255, 255, 1]);
    const bgSecondary = compositeOver(parseColor(t.color.bg.secondary), [255, 255, 255, 1]);
    const bgTertiary = compositeOver(parseColor(vars["--bg-tertiary"] ?? t.color.bg.tertiary), [255, 255, 255, 1]);
    const fail = (id: string, ratio: number, needed: number, hint: string) =>
      raw.push({
        theme: themeId,
        id,
        ratio: Math.round(ratio * 100) / 100,
        needed,
        message: `${themeId} ${hint} is ${(Math.round(ratio * 100) / 100).toFixed(2)}:1 (needs ${needed}). Retint src/theme/themes/${themeId}.ts or add an exempt entry with a reason to scripts/theme-contrast-baseline.json.`,
      });
    const check = (id: string, fg: string, bg: RGB, needed: number, hint: string) => {
      try {
        const ratio = contrastRatio(compositeOver(parseColor(fg), [...bg, 1] as RGBA), bg);
        if (ratio < needed) fail(id, ratio, needed, hint);
      } catch (e) {
        problems.push(`${themeId} ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const bgs: [string, RGB][] = [
      ["bg.primary", bgPrimary],
      ["bg.secondary", bgSecondary],
      ["bg.tertiary", bgTertiary],
    ];
    for (const [tok, get] of TEXT_TOKENS) {
      for (const [bgName, bg] of bgs) check(`${tok}/${bgName}`, get(t), bg, 4.5, `${tok} on ${bgName}`);
    }
    check("codeText/bg.secondary", vars["--code-text-color"], bgSecondary, 4.5, "codeText on bg.secondary");
    for (const [tok, get] of BOUNDARY_TOKENS) {
      const v = get(t);
      if (v === undefined) continue;
      check(`${tok}/bg.primary`, v, bgPrimary, 3.0, `${tok} on bg.primary`);
      check(`${tok}/bg.secondary`, v, bgSecondary, 3.0, `${tok} on bg.secondary`);
    }
    check("mdChar/bg.primary", vars["--md-char-color"], bgPrimary, 3.0, "mdChar on bg.primary");
    check("mdChar/bg.secondary", vars["--md-char-color"], bgSecondary, 3.0, "mdChar on bg.secondary");

    // C1c — blends, composited before measuring.
    const accentBlend = compositeOver(parseColor(t.color.accent.bg), [...bgPrimary, 1] as RGBA);
    check("text.primary/blend(accent.bg)", t.color.text.primary, accentBlend, 4.5, "text.primary on blended accent.bg");
    const selectionBlend = compositeOver(parseColor(t.color.selection), [...bgPrimary, 1] as RGBA);
    check("text.primary/blend(selection)", t.color.text.primary, selectionBlend, 4.5, "text.primary on blended selection");
    const accentFill = compositeOver(parseColor(t.color.accent.primary), [...bgPrimary, 1] as RGBA);
    check("contrastText/accent.primary", vars["--contrast-text"] ?? "white", accentFill, 4.5, "contrastText on accent.primary");

    // C1d — ANSI.
    const floor = baseline.ansiFloor?.[themeId]?.value ?? 4.5;
    for (const [slot, value] of Object.entries(t.terminal.ansi)) {
      check(`ansi.${slot}/bg.primary`, value, bgPrimary, floor, `ansi.${slot} on bg.primary`);
    }
    for (const name of BRIGHT_PAIRS) {
      const bright = `bright${name[0].toUpperCase()}${name.slice(1)}` as keyof typeof t.terminal.ansi;
      const a = parseColor(t.terminal.ansi[name]);
      const b = parseColor(t.terminal.ansi[bright]);
      const delta = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      if (delta < 15) {
        raw.push({
          theme: themeId,
          id: `ansi.${bright}≈${name}`,
          ratio: delta,
          needed: 15,
          message: `${themeId} ansi.${name} == ansi.${bright} (Δ${delta}): bold text is indistinguishable. Derive the bright row by a luminance step.`,
        });
      }
    }
    const textTiers = new Set([t.color.text.primary, t.color.text.secondary, t.color.text.tertiary].map(normHex));
    const boldFlag = (t.terminal as { boldTextInBrightColors?: boolean }).boldTextInBrightColors;
    const collides = BRIGHT_PAIRS.some((n) => {
      const bright = `bright${n[0].toUpperCase()}${n.slice(1)}` as keyof typeof t.terminal.ansi;
      return textTiers.has(normHex(t.terminal.ansi[bright]));
    });
    if (collides && boldFlag !== false) {
      raw.push({
        theme: themeId,
        id: "terminal.boldTextInBrightColors",
        ratio: 0,
        needed: 0,
        message: `${themeId}: a bright ANSI slot equals a text tier, so xterm's drawBoldTextInBrightColors repaints bold text as body grey — set terminal.boldTextInBrightColors: false.`,
      });
    }

    // C1e — syntax block, when present (typed since WI-UI1.5).
    const syntax = (t as unknown as { syntax?: Record<string, string> }).syntax;
    if (syntax) {
      for (const [role, value] of Object.entries(syntax)) {
        check(`syntax.${role}/bg.primary`, value, bgPrimary, 4.5, `syntax.${role} on bg.primary`);
        check(`syntax.${role}/bg.secondary`, value, bgSecondary, 4.5, `syntax.${role} on bg.secondary`);
      }
    }

    // C1f — surface ramp (Q1).
    const ramp = contrastRatio(bgSecondary, bgPrimary);
    if (ramp < 1.15) {
      fail("surface-ramp/bg.secondary", ramp, 1.15, "bg.secondary vs bg.primary");
    }

    // Exemptions subtract; an exempt entry matching nothing is stale.
    const exempt = baseline.exempt?.[themeId] ?? [];
    const exemptIds = new Set(exempt.map((e) => e.id));
    for (const e of exempt) {
      if (!raw.some((f) => f.id === e.id)) {
        problems.push(`exempt ${themeId}/${e.id} matches no finding any more — record the win by deleting it.`);
      }
    }
    findings.push(...raw.filter((f) => !exemptIds.has(f.id)));
  }
  return { findings, problems };
}

export function compareWithBaseline(
  findings: ContrastFinding[],
  baseline: ContrastBaseline,
  themeIds: string[],
): { newFindings: ContrastFinding[]; stale: { theme: string; id: string }[] } {
  const failing = baseline.failing ?? {};
  const newFindings = findings.filter((f) => !(failing[f.theme] ?? []).includes(f.id));
  const stale: { theme: string; id: string }[] = [];
  for (const [theme, ids] of Object.entries(failing)) {
    for (const id of ids) {
      const live = themeIds.includes(theme) && findings.some((f) => f.theme === theme && f.id === id);
      if (!live) stale.push({ theme, id });
    }
  }
  return { newFindings, stale };
}

/** D10: the ANSI floors assume xterm lifts foregrounds to ≥ 4.5 at paint time. */
export function checkMinimumContrastFloor(defaultsSource: string): string | null {
  const m = /minimumContrastRatio:\s*([\d.]+)/.exec(defaultsSource);
  if (!m) return "could not find minimumContrastRatio in src/stores/settingsStore/defaults.ts — the ANSI floors rest on it (D10).";
  if (Number(m[1]) < 4.5) {
    return `minimumContrastRatio default is ${m[1]} but the ANSI floors in theme-contrast-baseline.json assume >= 4.5 (D10).`;
  }
  return null;
}

const BASELINE_PATH = "scripts/theme-contrast-baseline.json";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const baselinePath = args.includes("--baseline") ? args[args.indexOf("--baseline") + 1] : BASELINE_PATH;
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as ContrastBaseline;
  const { themes } = await import("../src/theme/themes/index.ts");
  const themeIds = Object.keys(themes);
  const { findings, problems } = contrastFindings(themes, baseline);

  const floorProblem = checkMinimumContrastFloor(readFileSync("src/stores/settingsStore/defaults.ts", "utf8"));
  if (floorProblem) problems.push(floorProblem);

  if (args.includes("--update")) {
    const failing: Record<string, string[]> = {};
    for (const id of themeIds) failing[id] = findings.filter((f) => f.theme === id).map((f) => f.id);
    writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, failing }, null, 2)}\n`);
    console.log(`updated ${baselinePath}: ${findings.length} failing pair(s) across ${themeIds.length} themes`);
    process.exit(0);
  }

  const { newFindings, stale } = compareWithBaseline(findings, baseline, themeIds);
  let failed = false;
  if (problems.length > 0) {
    failed = true;
    console.error("Baseline problems:");
    for (const p of problems) console.error(`  ✗ ${p}`);
  }
  if (newFindings.length > 0) {
    failed = true;
    console.error("New contrast failures (not in the baseline):");
    for (const f of newFindings) console.error(`  ✗ ${f.message}`);
  }
  if (stale.length > 0) {
    failed = true;
    console.error("Stale baseline entries (now passing — record the win by removing them):");
    for (const s of stale) console.error(`  ✗ ${s.theme} ${s.id}`);
  }
  if (failed) process.exit(1);
  console.log(
    `✅ theme contrast: ${themeIds.length} themes measured, ${findings.length} baselined failing pair(s), 0 new.`,
  );
}
