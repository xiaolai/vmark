import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Tab as TabType } from "@/stores/tabStore";

const { docState, renameState } = vi.hoisted(() => ({
  docState: {
    documents: {} as Record<string, Record<string, unknown>>,
  },
  renameState: { renamingTabId: null as string | null },
}));

function zustandMock<T extends object>(state: T) {
  const store = ((selector?: (s: T) => unknown) =>
    typeof selector === "function" ? selector(state) : state) as unknown as {
    (selector: (s: T) => unknown): unknown;
    getState: () => T;
    subscribe: () => () => void;
  };
  store.getState = () => state;
  store.subscribe = () => () => {};
  return store;
}

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: zustandMock(docState),
}));

vi.mock("@/stores/tabRenameStore", () => ({
  useTabRenameStore: zustandMock(renameState),
}));

// Interpolation is preserved: the close button's accessible name is built from
// a `{title}` param, so a mock that dropped params would make any assertion
// about that name vacuous.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, params?: Record<string, unknown>) =>
      params?.title === undefined ? k : `${k}:${String(params.title)}`,
  }),
}));

// Stand-in for the real inline rename editor: a nested <input> that, like the
// real one, does NOT stop keydown propagation. That is exactly the condition the
// tab's key guard has to survive.
const renameProps = vi.fn();
vi.mock("./TabRenameInput", () => ({
  TabRenameInput: (props: { filePath: string; fileName: string }) => {
    renameProps(props);
    return <input data-testid="rename-input" defaultValue={props.fileName} />;
  },
}));

import { Tab } from "./Tab";
import { useSettingsStore } from "@/stores/settingsStore";

const baseTab: TabType = {
  kind: "document",
  id: "tab-1",
  filePath: "/docs/note.md",
  title: "note.md",
  isPinned: false,
  formatId: "markdown",
};

function renderTab(overrides: Partial<React.ComponentProps<typeof Tab>> = {}) {
  const handlers = {
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onContextMenu: vi.fn(),
    onKeyDown: vi.fn(),
  };
  render(
    <Tab tab={baseTab} isActive {...handlers} {...overrides} />,
  );
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  docState.documents = { "tab-1": { isDirty: false, isMissing: false, isDivergent: false, filePath: "/docs/note.md" } };
  renameState.renamingTabId = null;
});

describe("Tab", () => {
  it("activates on click", async () => {
    const user = userEvent.setup();
    const { onActivate } = renderTab();

    await user.click(screen.getByRole("tab"));

    expect(onActivate).toHaveBeenCalledWith("tab-1");
  });

  it("forwards key events aimed at the tab itself", async () => {
    const user = userEvent.setup();
    const { onKeyDown } = renderTab();

    screen.getByRole("tab").focus();
    await user.keyboard("{ArrowRight}");

    expect(onKeyDown).toHaveBeenCalledWith("tab-1", expect.anything());
  });

  it("closes on close-button click without activating the tab", async () => {
    const user = userEvent.setup();
    const { onClose, onActivate } = renderTab();

    await user.click(screen.getByRole("button", { name: /closeTab/i }));

    expect(onClose).toHaveBeenCalledWith("tab-1");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("closes on middle-click", async () => {
    const user = userEvent.setup();
    const { onClose } = renderTab();

    await user.pointer({ keys: "[MouseMiddle]", target: screen.getByRole("tab") });

    expect(onClose).toHaveBeenCalledWith("tab-1");
  });

  it("does not route keys pressed on the close button into tab navigation", async () => {
    const user = userEvent.setup();
    const { onKeyDown, onClose } = renderTab();

    screen.getByRole("button", { name: /closeTab/i }).focus();
    await user.keyboard("{Enter}");

    // The button's own click handler closes the tab; the tab strip's key
    // handler (activate / arrow-navigate) must stay out of it.
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith("tab-1");
  });

  describe("while renaming", () => {
    beforeEach(() => {
      renameState.renamingTabId = "tab-1";
    });

    it("does not route caret keys typed in the rename input into tab navigation", async () => {
      const user = userEvent.setup();
      const { onKeyDown, onActivate } = renderTab();

      const input = screen.getByTestId("rename-input");
      input.focus();
      await user.keyboard("{ArrowLeft}{ArrowRight}{Home}{End}{Enter}");

      // Arrows in the input used to bubble into the tablist roving-focus
      // handler, which moved DOM focus to another tab — blurring the input and
      // committing a half-typed rename.
      expect(onKeyDown).not.toHaveBeenCalled();
      expect(onActivate).not.toHaveBeenCalled();
    });

    it("passes the basename of a Windows path to the rename editor", () => {
      renderTab({
        tab: { ...baseTab, filePath: "C:\\docs\\note.md" } as TabType,
      });

      expect(renameProps).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: "note.md" }),
      );
    });
  });

  // #1224 — the stored title is the real file name; whether its extension
  // reaches the eye is this component's call, so the toggle takes effect on
  // already-open tabs rather than only on the next one.
  describe("file extensions", () => {
    const setShowExtensions = (value: boolean) =>
      useSettingsStore.setState((s) => ({
        general: { ...s.general, showFileExtensions: value },
      }));

    afterEach(() => setShowExtensions(true));

    it("shows the extension by default", () => {
      renderTab();
      expect(screen.getByRole("tab")).toHaveTextContent("note.md");
    });

    it("hides it when the setting is off", () => {
      setShowExtensions(false);
      renderTab();
      const label = screen.getByRole("tab").querySelector(".tab-title");
      expect(label?.textContent).toBe("note");
    });

    // Setting the store BEFORE render proves nothing about reactivity — a
    // non-reactive implementation reading the value once would pass. Flip it
    // on a mounted tab instead: that is the behaviour the design claims.
    it("relabels an already-open tab when the setting flips", () => {
      renderTab();
      const label = () => screen.getByRole("tab").querySelector(".tab-title");
      expect(label()?.textContent).toBe("note.md");

      act(() => setShowExtensions(false));
      expect(label()?.textContent).toBe("note");

      act(() => setShowExtensions(true));
      expect(label()?.textContent).toBe("note.md");
    });

    // `config.json` and `config.yaml` both collapse to "config" — an
    // accessible name has to stay unambiguous even when the visible label
    // cannot be.
    it("keeps the full name in the close button's accessible name", () => {
      setShowExtensions(false);
      renderTab();
      expect(screen.getByRole("button", { name: "closeTab:note.md" })).toBeInTheDocument();
    });

    it("leaves an unsupported extension visible even when hiding", () => {
      setShowExtensions(false);
      renderTab({
        tab: { ...baseTab, filePath: "/docs/App.vue", title: "App.vue" } as TabType,
      });
      const label = screen.getByRole("tab").querySelector(".tab-title");
      expect(label?.textContent).toBe("App.vue");
    });
  });
});
