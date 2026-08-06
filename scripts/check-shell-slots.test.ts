/**
 * WI-12 — shell-surface identity gate (ADR-007).
 *
 * Tests run the REAL script as a subprocess against tmpdir fixture trees, the
 * house pattern (scripts/check-mock-boundaries.test.mjs): a gate is only worth
 * what it does when invoked the way CI invokes it.
 *
 * The load-bearing case is "old regex missed it, new gate catches it". The
 * removed regex is reproduced here as a literal so that proof is DURABLE — it
 * re-runs on every suite instead of living in a PR description, and it fails if
 * the gate ever regresses to name-shape matching.
 *
 * Every failure case asserts on the MESSAGE, not just the exit code, so a
 * missing or crashing script (also exit 1) cannot fake a pass.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-shell-slots.mjs");

/**
 * The exact detector WI-12 removed: a line-anchored name-suffix regex counted
 * into a single integer budget. Kept verbatim so the escape forms it permitted
 * stay provably closed.
 */
const LEGACY_SURFACE_RE = /^\s*<([A-Z][A-Za-z]*(?:Overlay|Panel|Dialog|Picker|Modal|Toast))[\s/>]/gm;

function legacyMatches(source: string): string[] {
  return [...source.matchAll(LEGACY_SURFACE_RE)].map((m) => m[1]);
}

/**
 * A minimal App.tsx whose shell composition mounts `overlays`, plus any extra
 * props. The three non-surface bindings are imported unconditionally: the gate
 * checks its exclusion allowlist for staleness in both directions, so an
 * exclusion whose binding is not imported is itself a failure.
 */
const LIFECYCLE_IMPORT = `import { DocumentWindowMount, MainWindowRunners } from "@/hooks/lifecycle";`;

function appSource(overlays: string, extraProps = "", extraImports = ""): string {
  return [
    `import { AppShell, EditorArea } from "@/shell";`,
    LIFECYCLE_IMPORT,
    extraImports,
    `export function MainLayout() {`,
    `  return (`,
    `    <AppShell`,
    `      ${extraProps}`,
    `      overlays={`,
    `        <>`,
    overlays,
    `        </>`,
    `      }`,
    `    />`,
    `  );`,
    `}`,
  ].join("\n");
}

/** Run the real gate over a fixture App source + baseline. `baseline` may be a
 *  raw string (for malformed-JSON cases) or an object serialized to JSON. */
function runGate(
  app: string,
  baseline: unknown,
): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "shell-slots-"));
  const appPath = path.join(dir, "App.tsx");
  const baselinePath = path.join(dir, "baseline.json");
  writeFileSync(appPath, app);
  writeFileSync(
    baselinePath,
    typeof baseline === "string" ? baseline : `${JSON.stringify(baseline, null, 2)}\n`,
  );
  const res = spawnSync(process.execPath, [SCRIPT, "--app", appPath, "--baseline", baselinePath], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const surfaces = (...names: string[]) => ({ surfaces: names });

describe("check-shell-slots.mjs — identity gate over fixture App sources", () => {
  it("fails on a mounted surface absent from the baseline, naming it", () => {
    const { status, stderr } = runGate(
      appSource(`          <FooPanel />`),
      surfaces(),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("FooPanel");
    expect(stderr).toContain("NOT in the identity baseline");
  });

  it("catches every escape form the removed line-anchored suffix regex permitted", () => {
    // Three real evasion shapes: a plural suffix, a suffix outside the list, and
    // a mount that is not at the start of a line.
    const app = appSource(
      `          <CoherenceOverlays />\n          <CommandPalette />`,
      `sidePanel={<KnowledgeBaseOverlay />}`,
    );

    // RED proof, durable: the old detector sees none of the three.
    expect(legacyMatches(app)).toEqual([]);

    const { status, stderr } = runGate(app, surfaces());
    expect(status).toBe(1);
    for (const name of ["CoherenceOverlays", "CommandPalette", "KnowledgeBaseOverlay"]) {
      expect(stderr).toContain(name);
    }
  });

  it("fails when the baseline lists a surface that is no longer mounted (two-way)", () => {
    const { status, stderr } = runGate(
      appSource(`          <QuickLookOverlay />`),
      surfaces("QuickLookOverlay", "RetiredPanel"),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("RetiredPanel");
    expect(stderr).toContain("no longer mounted");
  });

  it("fails a like-for-like swap at constant count, naming both sides", () => {
    const { status, stderr } = runGate(
      appSource(`          <QuickLookOverlay />\n          <NewlyAddedPanel />`),
      surfaces("QuickLookOverlay", "SwappedOutPanel"),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("NewlyAddedPanel");
    expect(stderr).toContain("SwappedOutPanel");
  });

  it("passes when the mounted set matches the baseline exactly", () => {
    const { status, stdout } = runGate(
      appSource(`          <QuickLookOverlay />\n          <ApprovalDialog />`),
      surfaces("ApprovalDialog", "QuickLookOverlay"),
    );
    expect(status).toBe(0);
    expect(stdout).toContain("2 surfaces");
  });

  it("recurses through transparent wrappers instead of counting them", () => {
    const app = appSource(
      [
        `          <Suspense fallback={null}>`,
        `            <TerminalPanel />`,
        `          </Suspense>`,
        `          <FeatureErrorBoundary feature="editor">`,
        `            <DocumentSplitContainer />`,
        `          </FeatureErrorBoundary>`,
      ].join("\n"),
    );
    const { status, stdout } = runGate(app, surfaces("DocumentSplitContainer", "TerminalPanel"));
    expect(status).toBe(0);
    expect(stdout).toContain("2 surfaces");
  });

  it("excludes the three named non-surface bindings, but not their contents", () => {
    const app = appSource(
      [
        `          <DocumentWindowMount />`,
        `          <MainWindowRunners />`,
        `          <EditorArea sidePanel={<KnowledgeBaseOverlay />} />`,
      ].join("\n"),
      "",
      `import { KnowledgeBaseOverlay } from "@/components/KnowledgeBasePanel/KnowledgeBaseOverlay";`,
    );
    const { status, stdout } = runGate(app, surfaces("KnowledgeBaseOverlay"));
    expect(status).toBe(0);
    expect(stdout).toContain("1 surfaces");
  });

  // ── The exclusion allowlist is by BINDING, not by import namespace ──
  // `@/shell` and `@/hooks` used to be excluded wholesale. Three bindings are
  // actually excluded (EditorArea, DocumentWindowMount, MainWindowRunners); the
  // namespace form silently pre-approved every future export of two large
  // module trees — including `@/hooks/…` components that DO render.

  it("counts a rendering component imported from @/hooks that is not on the allowlist", () => {
    const app = appSource(
      `          <HookishPanel />`,
      "",
      `import { HookishPanel } from "@/hooks/useHookishPanel";`,
    );
    const { status, stderr } = runGate(app, surfaces());
    expect(status).toBe(1);
    expect(stderr).toContain("HookishPanel");
  });

  it("counts a non-allowlisted component imported from @/shell", () => {
    const app = appSource(
      `          <ShellExtraPanel />`,
      "",
      `import { ShellExtraPanel } from "@/shell/ShellExtraPanel";`,
    );
    const { status, stderr } = runGate(app, surfaces());
    expect(status).toBe(1);
    expect(stderr).toContain("ShellExtraPanel");
  });

  it("counts an allowlisted NAME imported from somewhere else — the module must match", () => {
    const app = [
      `import { AppShell } from "@/shell";`,
      LIFECYCLE_IMPORT,
      `import { EditorArea } from "@/components/Impostor/EditorArea";`,
      `export function MainLayout() {`,
      `  return <AppShell overlays={<><EditorArea /></>} />;`,
      `}`,
    ].join("\n");
    const { status, stderr } = runGate(app, surfaces());
    expect(status).toBe(1);
    expect(stderr).toContain("EditorArea");
  });

  it("fails when an allowlisted exclusion is no longer imported at all (staleness)", () => {
    // The other direction of the ratchet: a dead exclusion is standing
    // permission for whatever later claims that name.
    const app = [
      `import { AppShell, EditorArea } from "@/shell";`,
      `import { DocumentWindowMount } from "@/hooks/lifecycle";`, // MainWindowRunners gone
      `export function MainLayout() {`,
      `  return <AppShell overlays={<><DocumentWindowMount /><EditorArea /></>} />;`,
      `}`,
    ].join("\n");
    const { status, stderr } = runGate(app, surfaces());
    expect(status).toBe(1);
    expect(stderr).toContain("MainWindowRunners");
    expect(stderr.toLowerCase()).toContain("stale");
  });

  it("counts a surface nested inside another surface — nesting is not a hiding place", () => {
    const { status, stderr } = runGate(
      appSource(`          <OuterPanel>\n            <InnerDialog />\n          </OuterPanel>`),
      surfaces("OuterPanel"),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("InnerDialog");
  });

  it("treats names in comments, strings and imports as prose, not mounts", () => {
    const app = [
      `import { AppShell, EditorArea } from "@/shell";`,
      LIFECYCLE_IMPORT,
      `import { GhostOverlay } from "@/components/GhostOverlay";`,
      `const label = "<PhantomDialog />";`,
      `export function MainLayout() {`,
      `  // mentions <CommentedPanel /> in a comment`,
      `  return <AppShell overlays={<><RealDialog /></>} label={label} />;`,
      `}`,
    ].join("\n");
    const { status, stdout } = runGate(app, surfaces("RealDialog"));
    expect(status).toBe(0);
    expect(stdout).toContain("1 surfaces");
  });

  it("fails closed on a source that does not parse", () => {
    const { status, stderr } = runGate(
      `import { AppShell } from "@/shell";\nexport function MainLayout() { return ( <AppShell overlays={<><FooPanel /> );\n`,
      surfaces(),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("fails closed");
  });

  it("fails closed when no <AppShell> composition root is present", () => {
    const { status, stderr } = runGate(
      `export function MainLayout() {\n  return <div><FooPanel /></div>;\n}\n`,
      surfaces(),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("AppShell");
    expect(stderr).toContain("fails closed");
  });

  it("fails closed on a malformed baseline instead of reading it as empty", () => {
    const app = appSource(`          <FooPanel />`);
    for (const bad of ["{ not json", JSON.stringify({ maxDirectSurfaceMounts: 8 }), JSON.stringify({ surfaces: ["A", "A"] }), JSON.stringify({ surfaces: [42] })]) {
      const { status, stderr } = runGate(app, bad);
      expect(status).toBe(1);
      expect(stderr).toContain("Cannot read shell-surface baseline");
    }
  });
});

describe("check-shell-slots.mjs — against the real tree", () => {
  it("holds: every surface mounted in src/App.tsx is in the committed baseline", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8" });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });

  it("the committed baseline contains surfaces the removed regex could never see", () => {
    const app = readFileSync(path.join(REPO, "src", "App.tsx"), "utf8");
    const seenByLegacy = new Set(legacyMatches(app));
    const baselined: string[] = JSON.parse(
      readFileSync(path.join(REPO, "scripts", "shell-slots-baseline.json"), "utf8"),
    ).surfaces;
    const missedByLegacy = baselined.filter((name) => !seenByLegacy.has(name));
    // The undercount that motivated WI-12: the old gate saw 8 of 20.
    expect(missedByLegacy.length).toBeGreaterThanOrEqual(6);
    // Named, not just counted — these are the specific holes.
    for (const name of ["KnowledgeBaseOverlay", "CoherenceOverlays", "CommandPalette"]) {
      expect(baselined).toContain(name);
      expect(seenByLegacy.has(name)).toBe(false);
    }
  });
});
