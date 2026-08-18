/**
 * App composition root — the platform→chrome wiring (#1296).
 *
 * Every PART of this decision was already tested — `usesOverlayTitleBar()`,
 * `shellChromeVars()`, and AppShell's "reserve only when filled" — and none of
 * them could see the one line that connects them. Inverting the ternary in
 * App.tsx passed the entire suite: macOS would lose its title bar and
 * Windows/Linux would get the empty strip back, with every test still green.
 *
 * So this renders MainLayout with AppShell replaced by a prop recorder. The
 * recorder renders only the `overlays` slot — that one is App.tsx's own
 * composition, including the drop overlay defined in this very file. The editor
 * and sidebar slots stay unmounted: they are separate features with their own
 * suites, and mounting them here would drag their module graphs in behind them.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { isValidElement } from "react";
import type { ReactElement } from "react";

const platform = vi.hoisted(() => ({ overlayTitleBar: true, boom: false }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  usesOverlayTitleBar: () => {
    // A lever for making the layout throw, so the root error boundary has a
    // failure to catch (audit finding 9 — it had never been exercised).
    if (platform.boom) throw new Error("layout exploded");
    return platform.overlayTitleBar;
  },
}));

const appError = vi.hoisted(() => vi.fn());
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appError: (...args: unknown[]) => appError(...args),
}));

// The recorder. Captures the props the composition root passes and renders
// nothing, so no feature subtree mounts.
const shellProps = vi.hoisted(() => ({
  current: null as null | { chrome: unknown; style: Record<string, string> },
}));
vi.mock("@/shell", () => ({
  AppShell: (props: { chrome?: unknown; style?: Record<string, string>; overlays?: unknown }) => {
    shellProps.current = { chrome: props.chrome ?? null, style: props.style ?? {} };
    // Overlays ARE rendered: they are App.tsx's own composition (the drop
    // overlay lives in this file), and every component among them is already
    // loaded by its own suite, so mounting them costs no coverage denominator.
    return <>{props.overlays as ReactElement}</>;
  },
  EditorArea: () => null,
}));

// The feature subtrees App.tsx composes are stubbed, and deliberately so: this
// file tests the COMPOSITION, and every one of these has its own suite. Loading
// them for real also has a measurable cost — importing App.tsx pulled 12
// otherwise-unloaded modules into the coverage report (~80 uncovered functions
// in code no test exercises), which moved the global percentages without a line
// of production code becoming less tested.
vi.mock("@/components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/BottomBar/BottomBar", () => ({ BottomBar: () => null }));
vi.mock("@/components/CoherenceOverlays", () => ({ CoherenceOverlays: () => null }));
vi.mock("@/components/GeniePicker/GeniePickerOverlay", () => ({ GeniePickerOverlay: () => null }));
vi.mock("@/components/KnowledgeBasePanel/KnowledgeBaseOverlay", () => ({
  KnowledgeBaseOverlay: () => null,
}));
vi.mock("@/components/WindowStatusPanel/WindowStatusOverlay", () => ({
  WindowStatusOverlay: () => null,
}));

// Lifecycle hooks run real effects (Tauri listeners, workspace restore); the
// composition they belong to is not what this file is about.
vi.mock("@/hooks/lifecycle", () => ({
  useWorkspaceLifecycle: () => {},
  useEditorLifecycle: () => {},
  DocumentWindowMount: () => null,
  MainWindowRunners: () => null,
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => {}, FOCUS_DIM_OPACITY: {} }));
vi.mock("@/components/Terminal/useTerminalPosition", () => ({ useTerminalPosition: () => {} }));
vi.mock("@/hooks/useTabModeSync", () => ({ useTabModeSync: () => {} }));
vi.mock("@/hooks/useWindowStatus", () => ({ useWindowStatus: () => {} }));
vi.mock("@/contexts/WindowContext", () => ({
  WindowProvider: ({ children }: { children: unknown }) => children,
  useIsDocumentWindow: () => true,
  useWindowLabel: () => "main",
}));

const AppModule = await import("./App");
const { MainLayout } = AppModule;
const App = AppModule.default;

beforeEach(() => {
  platform.overlayTitleBar = true;
  platform.boom = false;
  appError.mockReset();
  shellProps.current = null;
});

/** The captured chrome slot, asserted to be an element or null — never `false`. */
function capturedChrome(): ReactElement | null {
  const chrome = shellProps.current?.chrome ?? null;
  if (chrome === null) return null;
  expect(isValidElement(chrome)).toBe(true);
  return chrome as ReactElement;
}

describe("MainLayout — chrome is mounted only where the app overlays the title bar", () => {
  it("passes a chrome element on macOS", () => {
    render(<MainLayout />);
    const chrome = capturedChrome();
    expect(chrome).not.toBeNull();
    // Named, so swapping the slot's occupant is a deliberate edit.
    expect((chrome?.type as { name?: string })?.name).toBe("AppTitleBar");
  });

  it("passes NO chrome off macOS", () => {
    platform.overlayTitleBar = false;
    render(<MainLayout />);
    expect(capturedChrome()).toBeNull();
  });

  it("reserves the traffic-light inset on macOS", () => {
    render(<MainLayout />);
    expect(shellProps.current?.style["--traffic-lights-inset"]).toBe("28px");
  });

  it("reserves no traffic-light inset off macOS", () => {
    platform.overlayTitleBar = false;
    render(<MainLayout />);
    expect(shellProps.current?.style["--traffic-lights-inset"]).toBe("0px");
  });

  it("publishes the rail width on both platforms", () => {
    render(<MainLayout />);
    expect(shellProps.current?.style["--workspace-rail-width"]).toBe("30px");
    platform.overlayTitleBar = false;
    render(<MainLayout />);
    expect(shellProps.current?.style["--workspace-rail-width"]).toBe("30px");
  });

  // The route table is the only thing between the app's entry point and the
  // layout under test; without this the wiring above is proven for a component
  // nothing is shown to reach.
  it("is what the app's own '/' route renders", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );
    expect(capturedChrome()).not.toBeNull();
  });

  it("keeps the chrome slot and the inset on the SAME side of the decision", () => {
    // The failure this guards is a half-applied change: chrome dropped but the
    // inset left at 28px would put a 28px gap above a window with no title bar.
    for (const overlay of [true, false]) {
      platform.overlayTitleBar = overlay;
      render(<MainLayout />);
      const hasChrome = capturedChrome() !== null;
      const reservesInset = shellProps.current?.style["--traffic-lights-inset"] !== "0px";
      expect(hasChrome).toBe(reservesInset);
    }
  });
});

// Audit finding 9 — the root boundary had never been exercised. This does not
// give it a recovery path (still a one-way latch, and that is a product
// decision), but it pins that a render failure is caught and reported rather
// than taking the window down with a blank screen.
describe("App — the root error boundary", () => {
  it("renders the fallback instead of propagating a render failure", () => {
    platform.boom = true;
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );
    // The layout never composed; the boundary took over.
    expect(shellProps.current).toBeNull();
    expect(document.body.textContent).toContain("layout exploded");
  });

  it("reports the failure rather than swallowing it", () => {
    platform.boom = true;
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );
    expect(appError).toHaveBeenCalled();
  });
});

// The drop overlay is defined in App.tsx itself, so it is part of this file's
// composition rather than a feature import — and it had no test at all.
describe("App — the file-drop overlay", () => {
  it("stays out of the way until files are being dragged", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    useUIStore.setState({ isDraggingFiles: false });
    render(<MainLayout />);
    expect(screen.queryByText("Drop to open")).not.toBeInTheDocument();
  });

  it("appears while files are being dragged over the window", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    useUIStore.setState({ isDraggingFiles: true });
    render(<MainLayout />);
    expect(screen.getByText("Drop to open")).toBeInTheDocument();
    useUIStore.setState({ isDraggingFiles: false });
  });
});
