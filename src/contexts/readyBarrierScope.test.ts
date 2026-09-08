// @vitest-environment node
/**
 * Who waits on the menu-commands barrier must be exactly who signals it.
 *
 * `useWindowReady` decides by LABEL (`isDocumentWindowLabel`), because that is
 * all it has at handshake time. The signal, though, is emitted by
 * `useCommandBootstrap`, which is reached only through `useEditorLifecycle` →
 * `MainLayout` → the `/` route. Those two facts are joined by nothing a
 * compiler can see, and both failure directions are silent:
 *
 *   - a window kind that WAITS but never signals stalls for the whole budget
 *     and then logs an error about a mount that was never going to happen;
 *   - a window kind that SIGNALS but never waits is back to announcing itself
 *     on a timer, which is the defect this barrier removed.
 *
 * So the join is asserted here, against the real source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isDocumentWindowLabel } from "@/utils/windowLabels";

const APP = readFileSync("src/App.tsx", "utf8");

describe("menu-commands barrier scope", () => {
  it("mounts the editor lifecycle exactly once, in MainLayout", () => {
    const calls = APP.match(/^\s*useEditorLifecycle\(\);/gm) ?? [];
    expect(calls).toHaveLength(1);

    const mainLayout = APP.slice(
      APP.indexOf("export function MainLayout()"),
      APP.indexOf("function AppRoutes()"),
    );
    expect(mainLayout).toContain("useEditorLifecycle();");
  });

  it("routes only `/` to MainLayout", () => {
    // If another route mounted MainLayout, a non-document window could signal
    // a barrier nobody waits on.
    expect(APP).toContain('<Route path="/" element={<MainLayout />} />');
    const otherRoutes = APP.match(/path="(?!\/")[^"]+"/g) ?? [];
    expect(otherRoutes.length).toBeGreaterThan(0);
    for (const route of otherRoutes) {
      const after = APP.slice(APP.indexOf(route));
      const element = after.slice(0, after.indexOf("</Route>") + 1);
      expect(element, `${route} must not mount MainLayout`).not.toContain("<MainLayout");
    }
  });

  it("classifies every window kind the app can open", () => {
    // The `/` route is what document windows land on; settings and pdf-export
    // have their own. If a new non-document window kind ever gets a label that
    // reads as a document one, it would wait on a barrier it cannot signal.
    expect(isDocumentWindowLabel("main")).toBe(true);
    expect(isDocumentWindowLabel("doc-1")).toBe(true);
    expect(isDocumentWindowLabel("settings")).toBe(false);
    expect(isDocumentWindowLabel("pdf-export")).toBe(false);
  });

  it("keeps the signal on the bootstrap that mounts the listener", () => {
    const bootstrap = readFileSync("src/hooks/useCommandBootstrap.ts", "utf8");
    expect(bootstrap).toContain("signalMenuCommandsMounted");
    // Every path out of the mount must signal, so a window that never reports
    // ready is impossible — that is worse than one with dead menus. It used to
    // signal from a `finally`, which released the handshake but announced a
    // fully-dead menu as READY (audit #359); the verdict is now an argument,
    // so pin the two properties that replaced the `finally`:
    //   1. the failure path signals too — a `catch` that ends the async body
    //      without signalling would hang the handshake forever;
    //   2. no call site is argument-less — a bare `signalMenuCommandsMounted()`
    //      is the old lie, reporting mounted whatever actually happened.
    expect(bootstrap).toMatch(/catch\s*\([^)]*\)\s*{[^}]*signalMenuCommandsMounted\(/);
    expect(bootstrap).not.toMatch(/signalMenuCommandsMounted\(\s*\)/);
    const signals = bootstrap.match(/signalMenuCommandsMounted\(/g) ?? [];
    expect(signals.length, "success and failure paths both signal").toBeGreaterThanOrEqual(2);
  });
});
