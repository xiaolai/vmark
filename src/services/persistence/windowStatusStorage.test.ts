// Window-status panel persistence (#1120) — window-scoped, own key namespace.
import { beforeEach, describe, expect, it } from "vitest";

import {
  getWindowStatusStorageKey,
  windowStatusScopedStorage,
} from "./windowStatusStorage";
import {
  setCurrentWindowLabel,
  getWorkspaceStorageKey,
} from "./workspaceStorage";

beforeEach(() => {
  localStorage.clear();
  setCurrentWindowLabel("main");
});

describe("getWindowStatusStorageKey", () => {
  it("namespaces by window label", () => {
    expect(getWindowStatusStorageKey("main")).toBe("vmark-window-status:main");
    expect(getWindowStatusStorageKey("doc-3")).toBe("vmark-window-status:doc-3");
  });

  it("never collides with the workspace store key", () => {
    // Regression guard: reusing workspaceStorage's adapter would overwrite the
    // workspace blob with panel prefs (and vice-versa).
    expect(getWindowStatusStorageKey("main")).not.toBe(getWorkspaceStorageKey("main"));
  });
});

describe("windowStatusScopedStorage", () => {
  it("reads and writes the current window's key", () => {
    windowStatusScopedStorage.setItem("ignored", '{"state":{"pinned":true}}');
    expect(localStorage.getItem("vmark-window-status:main")).toBe(
      '{"state":{"pinned":true}}',
    );
    expect(windowStatusScopedStorage.getItem("ignored")).toBe(
      '{"state":{"pinned":true}}',
    );
  });

  it("follows setCurrentWindowLabel to a different key", () => {
    windowStatusScopedStorage.setItem("ignored", '{"state":"main-prefs"}');
    setCurrentWindowLabel("doc-2");
    expect(windowStatusScopedStorage.getItem("ignored")).toBeNull();
    windowStatusScopedStorage.setItem("ignored", '{"state":"doc2-prefs"}');
    expect(localStorage.getItem("vmark-window-status:doc-2")).toBe(
      '{"state":"doc2-prefs"}',
    );
    // main's value is untouched.
    expect(localStorage.getItem("vmark-window-status:main")).toBe(
      '{"state":"main-prefs"}',
    );
  });

  it("removeItem clears only the current window's key", () => {
    windowStatusScopedStorage.setItem("ignored", "data");
    windowStatusScopedStorage.removeItem("ignored");
    expect(windowStatusScopedStorage.getItem("ignored")).toBeNull();
  });
});
