import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { useShortcutsStore } from "@/stores/settingsStore";
import { buildSourceShortcutKeymap, getSourceBlockBounds } from "./sourceShortcuts";

// Shared mock state — must be hoisted so the vi.mock factory can close over it
const { uiStoreState } = vi.hoisted(() => ({
  uiStoreState: { toggleSidebar: vi.fn() },
}));

// Mock heavy dependencies so callbacks can be invoked without real CodeMirror state
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: vi.fn(() => uiStoreState) },
}));

vi.mock("./sourceShortcutsHelpers", () => ({
  runSourceAction: vi.fn((action: string) => (_view: unknown) => { void action; return true; }),
  setHeading: vi.fn((_level: number) => (_view: unknown) => true),
  increaseHeadingLevel: vi.fn((_view: unknown) => true),
  decreaseHeadingLevel: vi.fn((_view: unknown) => true),
  toggleBlockquote: vi.fn((_view: unknown) => true),
  toggleList: vi.fn((_view: unknown, _type: string) => true),
  openFindBar: vi.fn(() => true),
  findNextMatch: vi.fn((_view: unknown) => true),
  findPreviousMatch: vi.fn((_view: unknown) => true),
  formatCJKSelection: vi.fn((_view: unknown) => true),
  formatCJKFile: vi.fn((_view: unknown) => true),
  copySelectionAsHtml: vi.fn((_view: unknown) => true),
  doTransformUppercase: vi.fn((_view: unknown) => true),
  doTransformLowercase: vi.fn((_view: unknown) => true),
  doTransformTitleCase: vi.fn((_view: unknown) => true),
  doTransformToggleCase: vi.fn((_view: unknown) => true),
  doMoveLineUp: vi.fn((_view: unknown) => true),
  doMoveLineDown: vi.fn((_view: unknown) => true),
  doDuplicateLine: vi.fn((_view: unknown) => true),
  doDeleteLine: vi.fn((_view: unknown) => true),
  doJoinLines: vi.fn((_view: unknown) => true),
  doSortLinesAsc: vi.fn((_view: unknown) => true),
  doSortLinesDesc: vi.fn((_view: unknown) => true),
}));

vi.mock("@codemirror/commands", () => ({
  toggleBlockComment: vi.fn((_view: unknown) => true),
  selectLine: vi.fn((_view: unknown) => true),
}));

// Mock context detection so getSourceBlockBounds can be tested
vi.mock("@/plugins/sourceContextDetection/codeFenceDetection", () => ({
  getCodeFenceInfo: vi.fn(() => null),
}));
vi.mock("@/plugins/sourceContextDetection/tableDetection", () => ({
  getSourceTableInfo: vi.fn(() => null),
}));
vi.mock("@/plugins/sourceContextDetection/blockquoteDetection", () => ({
  getBlockquoteInfo: vi.fn(() => null),
}));
vi.mock("@/plugins/sourceContextDetection/listDetection", () => ({
  getListBlockBounds: vi.fn(() => null),
}));
vi.mock("@/utils/imeGuard", () => ({
  guardCodeMirrorKeyBinding: vi.fn((binding: unknown) => binding),
}));

function resetShortcuts() {
  useShortcutsStore.setState({ customBindings: {} });
}

beforeEach(resetShortcuts);
afterEach(resetShortcuts);

// Minimal mock CodeMirror view
const mockView = {} as unknown as import("@codemirror/view").EditorView;

function getBinding(key: string) {
  const bindings = buildSourceShortcutKeymap();
  return bindings.find((b) => b.key === key);
}

describe("buildSourceShortcutKeymap", () => {
  it("uses custom shortcut bindings from the store", () => {
    useShortcutsStore.setState({ customBindings: { italic: "Alt-i" } });
    const keys = buildSourceShortcutKeymap().map((binding) => binding.key);

    expect(keys).toContain("Alt-i");
    expect(keys).not.toContain("Mod-i");
  });

  it("toggleSidebar binding invokes uiStore.toggleSidebar and returns true (lines 125-126)", async () => {
    const { useUIStore } = await import("@/stores/uiStore");
    const toggleSidebarMock = vi.fn();
    vi.mocked(useUIStore.getState).mockReturnValue({ toggleSidebar: toggleSidebarMock } as never);

    // toggleSidebar is not a registered shortcut id — inject it via customBindings
    useShortcutsStore.setState({ customBindings: { toggleSidebar: "Alt-Mod-s" } } as never);
    const bindings = buildSourceShortcutKeymap();
    const binding = bindings.find((b) => b.key === "Alt-Mod-s");
    expect(binding).toBeDefined();
    const result = binding!.run!(mockView);
    expect(toggleSidebarMock).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("sourceMode binding returns true without action (line 133)", () => {
    const shortcut = useShortcutsStore.getState().getShortcut("sourceMode");
    const binding = getBinding(shortcut);
    expect(binding).toBeDefined();
    const result = binding!.run!(mockView);
    expect(result).toBe(true);
  });

  it("toggleComment binding calls toggleBlockComment (line 151)", async () => {
    const cmCommands = await import("@codemirror/commands");
    const shortcut = useShortcutsStore.getState().getShortcut("toggleComment");
    const binding = getBinding(shortcut);
    expect(binding).toBeDefined();
    binding!.run!(mockView);
    expect(cmCommands.toggleBlockComment).toHaveBeenCalledWith(mockView);
  });

  it("bulletList binding calls toggleList with 'bullet' (line 165)", async () => {
    const helpers = await import("./sourceShortcutsHelpers");
    const shortcut = useShortcutsStore.getState().getShortcut("bulletList");
    const binding = getBinding(shortcut);
    expect(binding).toBeDefined();
    binding!.run!(mockView);
    expect(helpers.toggleList).toHaveBeenCalledWith(mockView, "bullet");
  });

  it("orderedList binding calls toggleList with 'ordered' (line 166)", async () => {
    const helpers = await import("./sourceShortcutsHelpers");
    const shortcut = useShortcutsStore.getState().getShortcut("orderedList");
    const binding = getBinding(shortcut);
    expect(binding).toBeDefined();
    binding!.run!(mockView);
    expect(helpers.toggleList).toHaveBeenCalledWith(mockView, "ordered");
  });

  it("taskList binding calls toggleList with 'task' (line 167)", async () => {
    const helpers = await import("./sourceShortcutsHelpers");
    const shortcut = useShortcutsStore.getState().getShortcut("taskList");
    const binding = getBinding(shortcut);
    expect(binding).toBeDefined();
    binding!.run!(mockView);
    expect(helpers.toggleList).toHaveBeenCalledWith(mockView, "task");
  });

  it("selectLine binding calls selectLine from @codemirror/commands (line 189)", async () => {
    const cmCommands = await import("@codemirror/commands");
    const shortcut = useShortcutsStore.getState().getShortcut("selectLine");
    const binding = getBinding(shortcut);
    expect(binding).toBeDefined();
    binding!.run!(mockView);
    expect(cmCommands.selectLine).toHaveBeenCalledWith(mockView);
  });

  it("findReplace binding calls openFindBar (line 190)", async () => {
    const helpers = await import("./sourceShortcutsHelpers");
    const shortcut = useShortcutsStore.getState().getShortcut("findReplace");
    const binding = getBinding(shortcut);
    expect(binding).toBeDefined();
    binding!.run!(mockView);
    expect(helpers.openFindBar).toHaveBeenCalled();
  });
});

describe("getSourceBlockBounds", () => {
  it("returns null when no block is found", async () => {
    // All context detection mocks return null → should return null
    const { getCodeFenceInfo } = await import("@/plugins/sourceContextDetection/codeFenceDetection");
    const { getSourceTableInfo } = await import("@/plugins/sourceContextDetection/tableDetection");
    const { getBlockquoteInfo } = await import("@/plugins/sourceContextDetection/blockquoteDetection");
    const { getListBlockBounds } = await import("@/plugins/sourceContextDetection/listDetection");
    vi.mocked(getCodeFenceInfo).mockReturnValue(null);
    vi.mocked(getSourceTableInfo).mockReturnValue(null);
    vi.mocked(getBlockquoteInfo).mockReturnValue(null);
    vi.mocked(getListBlockBounds).mockReturnValue(null);

    const result = getSourceBlockBounds(mockView);
    expect(result).toBeNull();
  });
});
