import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetState } = vi.hoisted(() => ({
  mockGetState: vi.fn(() => ({ rootPath: "/workspace" })),
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: mockGetState },
}));

import { createFileLinkProvider } from "./fileLinkProvider";
import type { Terminal, IBufferLine } from "@xterm/xterm";

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

  it("returns undefined for null buffer line", () => {
    const term = {
      buffer: {
        active: {
          getLine: vi.fn(() => null),
        },
      },
    } as unknown as Terminal;
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(99, (links) => {
        expect(links).toBeUndefined();
        resolve();
      });
    });
  });

  it("fires onActivate callback when link is activated", () => {
    const term = makeTerm("error in /Users/foo/bar.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        links![0].activate(new MouseEvent("click"), "");
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts");
        resolve();
      });
    });
  });

  it("filters out paths without file extension", () => {
    const term = makeTerm("cd /usr/local/bin");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toBeUndefined();
        resolve();
      });
    });
  });

  it("filters out paths without a slash", () => {
    const term = makeTerm("filename.ts is missing");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toBeUndefined();
        resolve();
      });
    });
  });

  it("rejects ../ relative path that escapes workspace root", () => {
    const term = makeTerm("found ../src/components/App.tsx");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        // ../src/components/App.tsx from /workspace resolves outside workspace — rejected
        expect(links![0].text).toBe("../src/components/App.tsx");
        resolve();
      });
    });
  });

  it("rejects relative path with ../ that escapes workspace root", () => {
    const term = makeTerm("found ../../etc/passwd.txt");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        // Should return the raw relative path, not a resolved escape
        expect(links![0].text).toBe("../../etc/passwd.txt");
        resolve();
      });
    });
  });

  it("resolves relative path by stripping ./ prefix", () => {
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

  it("detects multiple file paths on the same line", () => {
    const term = makeTerm("diff /Users/a/foo.ts /Users/b/bar.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(2);
        expect(links![0].text).toBe("/Users/a/foo.ts");
        expect(links![1].text).toBe("/Users/b/bar.ts");
        resolve();
      });
    });
  });

  it("returns undefined for empty line", () => {
    const term = makeTerm("");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toBeUndefined();
        resolve();
      });
    });
  });

  it("handles path with only :line suffix (no :col)", () => {
    const term = makeTerm(" /Users/foo/bar.ts:42");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        resolve();
      });
    });
  });

  it("returns relative path as-is when no workspace root", () => {
    mockGetState.mockReturnValueOnce({ rootPath: null });

    const term = makeTerm("found ./src/main.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("src/main.ts");
        resolve();
      });
    });
  });

  it("link range has correct start and end positions", () => {
    const term = makeTerm("error in /Users/foo/bar.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        const range = links![0].range;
        // bufferLineNumber passed as 1, so y should be 1
        expect(range.start.y).toBe(1);
        expect(range.end.y).toBe(1);
        // x positions should be positive (1-indexed)
        expect(range.start.x).toBeGreaterThan(0);
        expect(range.end.x).toBeGreaterThan(range.start.x);
        resolve();
      });
    });
  });
});
