/**
 * #1224 — the title bar showed the file name with its extension chopped off by
 * `getFileNameWithoutExtension`, which cuts at the last dot regardless of
 * whether VMark knows the format. `App.vue` displayed as `App`: a name that
 * exists nowhere on disk, for a file VMark cannot even open.
 *
 * Stores are real (settings + tabs, driven via setState); only the document
 * state hook — a hook, not a store — is stubbed, since it reaches into editor
 * state this suite has no reason to bootstrap.
 */
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  filePath: "/tmp/notes.md" as string | null,
  isRenaming: false,
}));

vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentFilePath: () => mocks.filePath,
  useDocumentIsDirty: () => false,
  useDocumentIsMissing: () => false,
  useActiveTabId: () => "tab-1",
}));

const mockRenameFile = vi.fn().mockResolvedValue(true);
vi.mock("./useTitleBarRename", () => ({
  useTitleBarRename: () => ({ renameFile: mockRenameFile, isRenaming: mocks.isRenaming }),
}));

import { TitleBar } from "./TitleBar";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStore";

const untitledTab: Tab = {
  kind: "document",
  id: "tab-1",
  filePath: null,
  title: "Untitled-1",
  isPinned: false,
  formatId: "markdown",
};

function setShowExtensions(value: boolean) {
  useSettingsStore.setState((s) => ({
    general: { ...s.general, showFileExtensions: value },
    appearance: { ...s.appearance, showFilenameInTitlebar: true },
  }));
}

beforeEach(() => {
  // Without this the rename assertions below match a CALL FROM AN EARLIER
  // TEST and pass vacuously — which is how the first draft of this suite
  // "confirmed" a bug it never exercised.
  vi.clearAllMocks();
  mockRenameFile.mockResolvedValue(true);
  mocks.filePath = "/tmp/notes.md";
  mocks.isRenaming = false;
  setShowExtensions(true);
  useTabStore.setState({ tabs: { main: [untitledTab] }, activeTabId: { main: "tab-1" } });
});

afterEach(() => {
  useSettingsStore.setState((s) => ({
    general: { ...s.general, showFileExtensions: true },
    appearance: { ...s.appearance, showFilenameInTitlebar: false },
  }));
  useTabStore.setState({ tabs: {}, activeTabId: {} });
});

describe("TitleBar — file name", () => {
  it("shows the name as it is on disk by default", () => {
    render(<TitleBar />);
    expect(screen.getByRole("banner")).toHaveTextContent("notes.md");
  });

  it("hides a known extension when the setting is off", () => {
    setShowExtensions(false);
    render(<TitleBar />);
    expect(screen.getByText("notes")).toBeInTheDocument();
  });

  it("keeps an unknown extension visible even when hiding", () => {
    mocks.filePath = "/tmp/App.vue";
    setShowExtensions(false);
    render(<TitleBar />);
    expect(screen.getByText("App.vue")).toBeInTheDocument();
  });

  it("falls back to the tab title for an unsaved document", () => {
    mocks.filePath = null;
    render(<TitleBar />);
    expect(screen.getByText("Untitled-1")).toBeInTheDocument();
  });
});

// #1224 round 2 — the rename must obey the setting that was in effect when the
// editor OPENED, not whatever it reads at confirm time. Settings sync across
// windows, so a flip mid-rename would otherwise change the meaning of text the
// user already typed.
describe("TitleBar — rename honours the extension policy it opened with", () => {
  async function startRename(user: ReturnType<typeof userEvent.setup>) {
    render(<TitleBar />);
    await user.dblClick(screen.getByText(/notes/));
    return screen.getByRole("textbox");
  }

  it("does not re-attach when the editor showed the extension", async () => {
    const user = userEvent.setup();
    const input = await startRename(user);
    await user.clear(input);
    await user.type(input, "notes{Enter}");

    expect(mockRenameFile).toHaveBeenCalledWith("/tmp/notes.md", "notes", {
      preserveExtension: false,
    });
  });

  it("re-attaches when the editor hid the extension", async () => {
    setShowExtensions(false);
    const user = userEvent.setup();
    const input = await startRename(user);
    await user.clear(input);
    await user.type(input, "renamed{Enter}");

    expect(mockRenameFile).toHaveBeenCalledWith("/tmp/notes.md", "renamed", {
      preserveExtension: true,
    });
  });

  it("does not rename a file whose name only has surrounding whitespace", async () => {
    // Leading/trailing spaces are legal in a file name. Trimming before the
    // comparison made "unchanged" look like a change, so simply confirming the
    // name renamed the file out from under the user.
    mocks.filePath = "/tmp/ spaced .md";
    const user = userEvent.setup();
    render(<TitleBar />);
    await user.dblClick(screen.getByText(/spaced/));
    await user.type(screen.getByRole("textbox"), "{Enter}");

    expect(mockRenameFile).not.toHaveBeenCalled();
  });

  it("abandons the edit when another document takes over the title bar", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TitleBar />);
    await user.dblClick(screen.getByText(/notes/));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "half-typed");

    // The active tab changes under us — the half-typed name belongs to the
    // file we just left, and submitting it would rename the NEW one.
    mocks.filePath = "/tmp/other.md";
    rerender(<TitleBar />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(mockRenameFile).not.toHaveBeenCalled();
  });

  it("does not let a blur close the editor while a rename is in flight", async () => {
    // The input is DISABLED during the rename, and disabling a focused element
    // blurs it. With blur closing unconditionally, a failed rename lost the
    // editor — contradicting the documented "keep editing on failure".
    const user = userEvent.setup();
    const { rerender } = render(<TitleBar />);
    await user.dblClick(screen.getByText(/notes/));

    mocks.isRenaming = true;
    rerender(<TitleBar />);
    fireEvent.blur(screen.getByRole("textbox"));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("keeps the opening policy when the setting flips mid-rename", async () => {
    const user = userEvent.setup();
    const input = await startRename(user); // opened with the extension visible
    await user.clear(input);
    await user.type(input, "notes");

    // Another window turns extensions off while this rename is in progress.
    act(() => setShowExtensions(false));
    await user.type(input, "{Enter}");

    // Read live, `displayName` would now be "notes" — equal to what was typed —
    // and the rename would silently cancel instead of dropping the extension.
    expect(mockRenameFile).toHaveBeenCalledWith("/tmp/notes.md", "notes", {
      preserveExtension: false,
    });
  });
});
