import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFileLinkProvider } from "./fileLinkProvider";
import type { Terminal, IBufferLine } from "@xterm/xterm";

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: vi.fn(() => ({ rootPath: "/workspace" })) },
}));

function makeTerm(lineText: string): Terminal {
  const line: Partial<IBufferLine> = {
    translateToString: vi.fn(() => lineText),
  };
  return {
    buffer: {
      active: {
        getLine: vi.fn((idx: number) => (idx === 0 ? line : null)),
      },
    },
  } as unknown as Terminal;
}

describe("createFileLinkProvider", () => {
  let onActivate: (filePath: string) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    onActivate = vi.fn<(filePath: string) => void>();
  });

  it("detects absolute file paths", () => {
    const term = makeTerm("error in /Users/foo/bar.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        resolve();
      });
    });
  });

  it("resolves relative paths against workspace root", () => {
    const term = makeTerm("found ./src/main.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/workspace/src/main.ts");
        resolve();
      });
    });
  });

  it("detects paths with :line:col suffix", () => {
    const term = makeTerm(" /Users/foo/bar.ts:10:5");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        resolve();
      });
    });
  });

  it("filters out non-file paths", () => {
    const term = makeTerm("version 1.0.0 released");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toBeUndefined();
        resolve();
      });
    });
  });
});
