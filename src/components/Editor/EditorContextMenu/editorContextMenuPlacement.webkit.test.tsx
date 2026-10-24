/**
 * Editor context menu — viewport-anchored placement, measured in WebKit.
 *
 * The root composes `.vm-menu`, whose `position: fixed` is what lets the
 * inline `left`/`top` from `useMenuPosition` apply. Without it the menu is a
 * static flex item of `.app-shell`: it lands at the window's top-left, shifts
 * every sibling by its width, and the pointer coordinates are silently
 * ignored. jsdom has no layout, so this renders the PRODUCTION component
 * against the real stylesheets and reads the engine's geometry.
 */
import "@/styles/index.css";
import "@/styles/overlay-shared.css";
import { describe, it, expect, afterEach, vi } from "vitest";

// react-i18next's default suspense option throws a promise while namespaces
// load; the labels are irrelevant to placement, and a resolved promise would
// commit after the geometry assertions. Keep the module's other exports —
// the app's i18n setup imports initReactI18next from it.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorContextMenu } from "./EditorContextMenu";
import { useEditorContextMenuStore } from "@/stores/editorContextMenuStore";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot: EditorContextMenuSnapshot = {
  surface: "wysiwyg",
  selectionEmpty: false,
  inCodeBlock: false,
  headingLevel: null,
  listType: null,
  inBlockquote: false,
  link: null,
  formatPolicy: { paragraphFormatting: true, insertBlockActions: true },
  activeActions: [],
  disabledActions: [],
};

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Mount the menu inside the real shell layout (a flex row whose first child
 *  is the overlays slot, exactly as AppShell renders it). */
async function mount(): Promise<{ shell: HTMLElement; probe: HTMLElement }> {
  host = document.createElement("div");
  host.className = "app-shell";
  host.style.cssText = `width: ${Math.max(320, Math.min(1000, window.innerWidth - 16))}px; height: 600px`;
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <>
        <EditorContextMenu />
        <div className="probe-primary" style={{ flex: 1 }}>
          content
        </div>
      </>
    );
  });
  return { shell: host, probe: host.querySelector<HTMLElement>(".probe-primary")! };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useEditorContextMenuStore.getState().closeMenu();
});

describe("EditorContextMenu — placement", () => {
  it("is fixed-positioned at the pointer and does not displace the shell", async () => {
    const { shell, probe } = await mount();
    const shellLeft = shell.getBoundingClientRect().left;
    const probeLeft = probe.getBoundingClientRect().left;
    const x = Math.max(10, Math.min(120, window.innerWidth - 260));

    await act(async () => {
      useEditorContextMenuStore.getState().openMenu({ position: { x, y: 10 }, snapshot });
    });

    const menu = shell.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(getComputedStyle(menu!).position).toBe("fixed");

    const rect = menu!.getBoundingClientRect();
    expect(Math.round(rect.left)).toBe(x);
    expect(Math.round(rect.top)).toBe(10);

    // The menu's width must not become a flex column: the content stays put.
    expect(probe.getBoundingClientRect().left).toBe(probeLeft);
    expect(probeLeft).toBe(shellLeft);
  });
});
