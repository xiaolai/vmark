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

  it("resolves relative paths against the live cwd, overriding workspace root (WI-2.3)", () => {
    const term = makeTerm("found ./build/x.ts");
    // Shell has cd'd into a subdir; getCwd reflects that, not the workspace root.
    const provider = createFileLinkProvider(term, onActivate, () => "/workspace/pkg");

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/workspace/pkg/build/x.ts");
        resolve();
      });
    });
  });

  it("does NOT link a relative path that escapes the base (path traversal, audit-fix)", () => {
    const term = makeTerm("see ../../../../etc/secrets.env");
    const provider = createFileLinkProvider(term, onActivate, () => "/workspace/pkg");

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        // The escaping path must not become a clickable link.
        expect(links).toBeUndefined();
        resolve();
      });
    });
  });

  it("resolves a relative link when the base path contains spaces (audit-fix)", () => {
    const term = makeTerm("found ./build/x.ts");
    const provider = createFileLinkProvider(term, onActivate, () => "/Users/me/My Project");

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        // Must not be skipped due to percent-encoding of the space in the base.
        expect(links![0].text).toBe("/Users/me/My Project/build/x.ts");
        resolve();
      });
    });
  });

  it("falls back to workspace root when live cwd is null (WI-2.3)", () => {
    const term = makeTerm("found ./src/main.ts");
    const provider = createFileLinkProvider(term, onActivate, () => null);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
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

  it("passes parsed line and col to onActivate when the link is clicked (WI-4.1)", () => {
    const term = makeTerm(" /Users/foo/bar.ts:42:8");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        links![0].activate(null as unknown as MouseEvent, links![0].text);
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", 42, 8);
        resolve();
      });
    });
  });

  it("activates with undefined line/col for a bare path (WI-4.1)", () => {
    const term = makeTerm(" /Users/foo/bar.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        links![0].activate(null as unknown as MouseEvent, links![0].text);
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", undefined, undefined);
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
        // Bare path → no line/col (WI-4.1 added the optional args).
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", undefined, undefined);
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

  it("does NOT link a ../ relative path that escapes workspace root (path traversal)", () => {
    const term = makeTerm("found ../src/components/App.tsx");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        // Escapes /workspace → must not become a clickable link.
        expect(links).toBeUndefined();
        resolve();
      });
    });
  });

  it("does NOT link a ../../ path that escapes to a sensitive file (path traversal)", () => {
    const term = makeTerm("found ../../etc/passwd.txt");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toBeUndefined();
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

  it("does NOT link a relative path when there is no base (no workspace, no cwd)", () => {
    mockGetState.mockReturnValueOnce({ rootPath: null });

    const term = makeTerm("found ./src/main.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        // Nothing to anchor a relative path against → no clickable link.
        expect(links).toBeUndefined();
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

  // --- WI-4.6 coverage backfill: :line:col edge cases ---

  it("passes line=0 and col=0 through for a :0:0 suffix", () => {
    // Zero is a valid \d+ capture; parseInt yields 0 (falsy, but defined).
    const term = makeTerm(" /Users/foo/bar.ts:0:0");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        links![0].activate(null as unknown as MouseEvent, links![0].text);
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", 0, 0);
        resolve();
      });
    });
  });

  it("ignores a non-numeric suffix (path:abc), linking the bare path", () => {
    // `:abc` does not match `:(\d+)` so the suffix is not part of the path text,
    // and no line/col is parsed.
    const term = makeTerm(" /Users/foo/bar.ts:abc");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        links![0].activate(null as unknown as MouseEvent, links![0].text);
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", undefined, undefined);
        resolve();
      });
    });
  });

  it("parses line but not col for a trailing-colon suffix (path:10:)", () => {
    // The trailing `:` has no digits after it, so col stays undefined.
    const term = makeTerm(" /Users/foo/bar.ts:10:");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        links![0].activate(null as unknown as MouseEvent, links![0].text);
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", 10, undefined);
        resolve();
      });
    });
  });

  it("parses a very large line number (:999999)", () => {
    const term = makeTerm(" /Users/foo/bar.ts:999999");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        links![0].activate(null as unknown as MouseEvent, links![0].text);
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", 999999, undefined);
        resolve();
      });
    });
  });

  it("links a bare absolute path with no suffix and undefined line/col", () => {
    const term = makeTerm(" /Users/foo/bar.ts");
    const provider = createFileLinkProvider(term, onActivate);

    return new Promise<void>((resolve) => {
      provider.provideLinks(1, (links) => {
        expect(links).toHaveLength(1);
        expect(links![0].text).toBe("/Users/foo/bar.ts");
        links![0].activate(null as unknown as MouseEvent, links![0].text);
        expect(onActivate).toHaveBeenCalledWith("/Users/foo/bar.ts", undefined, undefined);
        resolve();
      });
    });
  });
});
