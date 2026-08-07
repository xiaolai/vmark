// @vitest-environment node
// recentsStore — MRU recents behind the native "Open Recent" menus.
// Codex audit finding: removal merged the cross-window list, CAPPED it,
// then filtered — removing one of the retained N dropped the candidate
// that should slide in (returned N-1 entries). Order must be:
// merge uncapped → filter removed → cap.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useRecentFilesStore,
  useRecentWorkspacesStore,
  type RecentFile,
} from "./recentsStore";
import {
  registerDockRecent,
  syncRecentFilesMenu,
  syncRecentWorkspacesMenu,
} from "@/stores/workspaceStoreHelpers";

vi.mock("@/stores/workspaceStoreHelpers", () => ({
  syncRecentFilesMenu: vi.fn(),
  syncRecentWorkspacesMenu: vi.fn(),
  registerDockRecent: vi.fn(),
}));

const FILES_KEY = "vmark-recent-files";
const WORKSPACES_KEY = "vmark-recent-workspaces";

let now = 1_000_000;
let nowSpy: ReturnType<typeof vi.spyOn>;

/** Write an entry straight to the shared key, as another window would. */
function otherWindowAdds(
  key: string,
  field: string,
  path: string,
  timestamp: number,
) {
  const raw = JSON.parse(
    localStorage.getItem(key) ?? '{"state":{},"version":0}',
  ) as { state: Record<string, unknown[]> };
  raw.state[field] = [
    { path, name: path.split("/").pop(), timestamp },
    ...(raw.state[field] ?? []),
  ];
  localStorage.setItem(key, JSON.stringify(raw));
}

beforeEach(() => {
  localStorage.clear();
  useRecentFilesStore.setState({ files: [] });
  useRecentWorkspacesStore.setState({ workspaces: [] });
  now = 1_000_000;
  nowSpy = vi.spyOn(Date, "now").mockImplementation(() => ++now);
  vi.mocked(syncRecentFilesMenu).mockClear();
  vi.mocked(syncRecentWorkspacesMenu).mockClear();
  vi.mocked(registerDockRecent).mockClear();
});

afterEach(() => {
  nowSpy.mockRestore();
});

describe("useRecentFilesStore — basic MRU behavior", () => {
  it("adds files newest-first and dedupes by path", () => {
    const { addFile } = useRecentFilesStore.getState();
    addFile("/a/x.md");
    addFile("/a/y.md");
    addFile("/a/x.md");
    expect(useRecentFilesStore.getState().files.map((f) => f.path)).toEqual([
      "/a/x.md",
      "/a/y.md",
    ]);
  });

  it("caps at maxFiles", () => {
    const { addFile, maxFiles } = useRecentFilesStore.getState();
    for (let i = 0; i < maxFiles + 3; i++) addFile(`/a/f${i}.md`);
    expect(useRecentFilesStore.getState().files).toHaveLength(maxFiles);
  });

  it("registers each added file as a dock recent and syncs the native menu", () => {
    useRecentFilesStore.getState().addFile("/a/x.md");
    expect(vi.mocked(registerDockRecent)).toHaveBeenCalledWith("/a/x.md");
    expect(vi.mocked(syncRecentFilesMenu)).toHaveBeenLastCalledWith(["/a/x.md"]);
  });

  it("derives the display name from the path", () => {
    useRecentFilesStore.getState().addFile("/a/note.md");
    expect(useRecentFilesStore.getState().files[0].name).toBe("note.md");
  });

  it("clearAll wipes the list and syncs an empty menu", () => {
    useRecentFilesStore.getState().addFile("/a/x.md");
    useRecentFilesStore.getState().clearAll();
    expect(useRecentFilesStore.getState().files).toEqual([]);
    expect(vi.mocked(syncRecentFilesMenu)).toHaveBeenLastCalledWith([]);
  });

  it("syncToNativeMenu pushes the current list", () => {
    useRecentFilesStore.getState().addFile("/a/x.md");
    vi.mocked(syncRecentFilesMenu).mockClear();
    useRecentFilesStore.getState().syncToNativeMenu();
    expect(vi.mocked(syncRecentFilesMenu)).toHaveBeenCalledWith(["/a/x.md"]);
  });

  it("removeFile filters, persists, and syncs", () => {
    useRecentFilesStore.getState().addFile("/a/x.md");
    useRecentFilesStore.getState().addFile("/a/y.md");
    useRecentFilesStore.getState().removeFile("/a/x.md");
    expect(useRecentFilesStore.getState().files.map((f) => f.path)).toEqual([
      "/a/y.md",
    ]);
    expect(vi.mocked(syncRecentFilesMenu)).toHaveBeenLastCalledWith(["/a/y.md"]);
  });
});

describe("useRecentFilesStore — removal at the cap (merge → filter → cap)", () => {
  it("removing a retained entry lets the next merge candidate slide in (full 10, not 9)", () => {
    const { addFile, maxFiles } = useRecentFilesStore.getState();
    // This window holds a full list of `maxFiles` entries.
    for (let i = 1; i <= maxFiles; i++) addFile(`/a/f${i}.md`);
    // Another window persisted an OLDER entry that no longer fits the cap.
    otherWindowAdds(FILES_KEY, "files", "/b/old.md", 5);

    useRecentFilesStore.getState().removeFile(`/a/f${maxFiles}.md`);

    const files = useRecentFilesStore.getState().files;
    expect(files.map((f: RecentFile) => f.path)).not.toContain(
      `/a/f${maxFiles}.md`,
    );
    // The freed slot is filled by the merge candidate, not left empty.
    expect(files).toHaveLength(maxFiles);
    expect(files.map((f: RecentFile) => f.path)).toContain("/b/old.md");
  });

  it("still caps at maxFiles when the merged pool exceeds it after the filter", () => {
    const { addFile, maxFiles } = useRecentFilesStore.getState();
    for (let i = 1; i <= maxFiles; i++) addFile(`/a/f${i}.md`);
    otherWindowAdds(FILES_KEY, "files", "/b/old1.md", 4);
    otherWindowAdds(FILES_KEY, "files", "/b/old2.md", 5);

    useRecentFilesStore.getState().removeFile("/a/f1.md");

    const files = useRecentFilesStore.getState().files;
    expect(files).toHaveLength(maxFiles);
    // Newer candidate wins the single freed slot.
    expect(files.map((f: RecentFile) => f.path)).toContain("/b/old2.md");
    expect(files.map((f: RecentFile) => f.path)).not.toContain("/b/old1.md");
  });
});

describe("useRecentWorkspacesStore — removal at the cap", () => {
  it("removing a retained workspace lets the next merge candidate slide in", () => {
    const { addWorkspace, maxWorkspaces } = useRecentWorkspacesStore.getState();
    for (let i = 1; i <= maxWorkspaces; i++) addWorkspace(`/w/s${i}`);
    otherWindowAdds(WORKSPACES_KEY, "workspaces", "/w/old", 5);

    useRecentWorkspacesStore.getState().removeWorkspace("/w/s1");

    const workspaces = useRecentWorkspacesStore.getState().workspaces;
    expect(workspaces).toHaveLength(maxWorkspaces);
    expect(workspaces.map((w) => w.path)).toContain("/w/old");
    expect(workspaces.map((w) => w.path)).not.toContain("/w/s1");
  });
});

describe("useRecentWorkspacesStore — basic behavior", () => {
  it("adds workspaces newest-first, capped, with menu sync (no dock registration)", () => {
    const { addWorkspace } = useRecentWorkspacesStore.getState();
    addWorkspace("/w/one");
    addWorkspace("/w/two");
    expect(
      useRecentWorkspacesStore.getState().workspaces.map((w) => w.path),
    ).toEqual(["/w/two", "/w/one"]);
    expect(vi.mocked(syncRecentWorkspacesMenu)).toHaveBeenLastCalledWith([
      "/w/two",
      "/w/one",
    ]);
    expect(vi.mocked(registerDockRecent)).not.toHaveBeenCalled();
  });
});
