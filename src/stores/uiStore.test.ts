import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./uiStore";

function resetUIStore() {
  useUIStore.setState({
    settingsOpen: false,
    sidebarVisible: false,
    sidebarWidth: 260,
    sidebarViewMode: "outline",
    activeHeadingLine: null,
    statusBarVisible: true,
    universalToolbarVisible: false,
    universalToolbarHasFocus: false,
    toolbarSessionFocusIndex: -1,
    toolbarDropdownOpen: false,
  });
}

beforeEach(resetUIStore);

describe("uiStore", () => {
  describe("focus toggle per spec Section 1.2", () => {
    it("opens toolbar with focus on first toggle", () => {
      const store = useUIStore.getState();

      store.toggleUniversalToolbar();
      expect(useUIStore.getState().universalToolbarVisible).toBe(true);
      expect(useUIStore.getState().universalToolbarHasFocus).toBe(true);
    });

    it("toggles focus (not visibility) when toolbar already visible", () => {
      const store = useUIStore.getState();

      // First toggle: opens toolbar with focus
      store.toggleUniversalToolbar();
      expect(useUIStore.getState().universalToolbarVisible).toBe(true);
      expect(useUIStore.getState().universalToolbarHasFocus).toBe(true);

      // Second toggle: keeps toolbar visible, toggles focus off
      store.toggleUniversalToolbar();
      expect(useUIStore.getState().universalToolbarVisible).toBe(true);
      expect(useUIStore.getState().universalToolbarHasFocus).toBe(false);

      // Third toggle: keeps toolbar visible, toggles focus on
      store.toggleUniversalToolbar();
      expect(useUIStore.getState().universalToolbarVisible).toBe(true);
      expect(useUIStore.getState().universalToolbarHasFocus).toBe(true);
    });

    it("clears focus when toolbar is hidden", () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
      });

      const store = useUIStore.getState();
      store.setUniversalToolbarVisible(false);

      expect(useUIStore.getState().universalToolbarVisible).toBe(false);
      expect(useUIStore.getState().universalToolbarHasFocus).toBe(false);
    });

    it("does not force focus when showing toolbar via setVisible", () => {
      const store = useUIStore.getState();
      store.setUniversalToolbarVisible(true);

      expect(useUIStore.getState().universalToolbarVisible).toBe(true);
      expect(useUIStore.getState().universalToolbarHasFocus).toBe(false);
    });
  });

  describe("session memory per spec Section 4.5", () => {
    it("stores session focus index", () => {
      const store = useUIStore.getState();

      store.setToolbarSessionFocusIndex(3);
      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(3);

      store.setToolbarSessionFocusIndex(5);
      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(5);
    });

    it("clears session focus index when toolbar hidden via setVisible", () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        toolbarSessionFocusIndex: 5,
      });

      useUIStore.getState().setUniversalToolbarVisible(false);

      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(-1);
    });

    it("preserves session focus index when toolbar stays visible", () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        toolbarSessionFocusIndex: 5,
      });

      // Toggle focus, not visibility
      useUIStore.getState().toggleUniversalToolbar();

      expect(useUIStore.getState().universalToolbarVisible).toBe(true);
      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(5);
    });

    it("starts with -1 indicating smart focus should be used", () => {
      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(-1);
    });
  });

  describe("dropdown state for two-step Escape", () => {
    it("tracks dropdown open state", () => {
      const store = useUIStore.getState();

      expect(useUIStore.getState().toolbarDropdownOpen).toBe(false);

      store.setToolbarDropdownOpen(true);
      expect(useUIStore.getState().toolbarDropdownOpen).toBe(true);

      store.setToolbarDropdownOpen(false);
      expect(useUIStore.getState().toolbarDropdownOpen).toBe(false);
    });

    it("clearToolbarSession closes dropdown", () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        toolbarDropdownOpen: true,
      });

      useUIStore.getState().clearToolbarSession();

      expect(useUIStore.getState().toolbarDropdownOpen).toBe(false);
    });
  });

  describe("toggleSidebarView", () => {
    it("shows sidebar with requested view when hidden", () => {
      useUIStore.getState().toggleSidebarView("files");

      const state = useUIStore.getState();
      expect(state.sidebarVisible).toBe(true);
      expect(state.sidebarViewMode).toBe("files");
    });

    it("switches view when sidebar is showing a different view", () => {
      useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "files" });

      useUIStore.getState().toggleSidebarView("outline");

      const state = useUIStore.getState();
      expect(state.sidebarVisible).toBe(true);
      expect(state.sidebarViewMode).toBe("outline");
    });

    it("hides sidebar when already showing the same view", () => {
      useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "history" });

      useUIStore.getState().toggleSidebarView("history");

      expect(useUIStore.getState().sidebarVisible).toBe(false);
    });

    it("preserves view mode when hiding", () => {
      useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "outline" });

      useUIStore.getState().toggleSidebarView("outline");

      // Sidebar hidden but mode preserved (so re-opening shows same view)
      expect(useUIStore.getState().sidebarVisible).toBe(false);
      expect(useUIStore.getState().sidebarViewMode).toBe("outline");
    });
  });

  describe("clearToolbarSession", () => {
    it("clears all toolbar state at once", () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 5,
        toolbarDropdownOpen: true,
      });

      useUIStore.getState().clearToolbarSession();

      const state = useUIStore.getState();
      expect(state.universalToolbarVisible).toBe(false);
      expect(state.universalToolbarHasFocus).toBe(false);
      expect(state.toolbarSessionFocusIndex).toBe(-1);
      expect(state.toolbarDropdownOpen).toBe(false);
    });

    it("is idempotent on already closed toolbar", () => {
      // Already reset from beforeEach
      useUIStore.getState().clearToolbarSession();

      const state = useUIStore.getState();
      expect(state.universalToolbarVisible).toBe(false);
      expect(state.universalToolbarHasFocus).toBe(false);
      expect(state.toolbarSessionFocusIndex).toBe(-1);
      expect(state.toolbarDropdownOpen).toBe(false);
    });
  });
});
