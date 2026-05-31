// WI-2.1 — OSC 7 cwd parsing + handler registration
// WI-3.2 — OSC 133 command-boundary tracking
import { describe, it, expect, vi } from "vitest";
import { parseOsc7Cwd, setupOsc7, setupOsc133, scrollToAdjacentCommand } from "./setupOsc";
import type { CommandMark } from "./setupOsc";

describe("parseOsc7Cwd", () => {
  it("extracts the path from a file:// URL with a host", () => {
    expect(parseOsc7Cwd("file://my-mac.local/Users/joker/project")).toBe(
      "/Users/joker/project",
    );
  });

  it("handles an empty host (file:///path)", () => {
    expect(parseOsc7Cwd("file:///Users/joker")).toBe("/Users/joker");
  });

  it("percent-decodes spaces and unicode", () => {
    expect(parseOsc7Cwd("file://h/Users/joker/My%20Docs/%E4%B8%AD")).toBe(
      "/Users/joker/My Docs/中",
    );
  });

  it("returns null for non-file payloads", () => {
    expect(parseOsc7Cwd("https://example.com")).toBeNull();
    expect(parseOsc7Cwd("/just/a/path")).toBeNull();
    expect(parseOsc7Cwd("")).toBeNull();
  });

  it("treats a shell at filesystem root (file://host/) as /", () => {
    expect(parseOsc7Cwd("file://my-mac.local/")).toBe("/");
  });
});

describe("setupOsc7", () => {
  function makeTerm() {
    let handler: ((data: string) => boolean) | null = null;
    const term = {
      parser: {
        registerOscHandler: vi.fn((id: number, h: (d: string) => boolean) => {
          if (id === 7) handler = h;
          return { dispose: vi.fn() };
        }),
      },
    } as unknown as import("@xterm/xterm").Terminal;
    return { term, fire: (d: string) => handler?.(d) };
  }

  it("starts with null cwd and updates it on a valid OSC 7", () => {
    const { term, fire } = makeTerm();
    const osc = setupOsc7(term);
    expect(osc.getCwd()).toBeNull();

    const handled = fire("file://h/Users/joker/work");
    expect(handled).toBe(true);
    expect(osc.getCwd()).toBe("/Users/joker/work");
  });

  it("ignores a malformed payload, keeping the previous cwd", () => {
    const { term, fire } = makeTerm();
    const osc = setupOsc7(term);
    fire("file://h/Users/joker");
    fire("garbage");
    expect(osc.getCwd()).toBe("/Users/joker");
  });

  it("registers the handler for OSC id 7", () => {
    const { term } = makeTerm();
    setupOsc7(term);
    expect(term.parser.registerOscHandler).toHaveBeenCalledWith(7, expect.any(Function));
  });
});

describe("setupOsc133", () => {
  function makeTerm() {
    let handler: ((data: string) => boolean) | null = null;
    let nextLine = 0;
    const disposers: Array<() => void> = [];
    const term = {
      parser: {
        registerOscHandler: vi.fn((id: number, h: (d: string) => boolean) => {
          if (id === 133) handler = h;
          return { dispose: vi.fn() };
        }),
      },
      registerMarker: vi.fn(() => {
        const line = nextLine++;
        return {
          line,
          onDispose: (cb: () => void) => disposers.push(cb),
          dispose: vi.fn(),
        };
      }),
      registerDecoration: vi.fn(() => ({ onRender: vi.fn(), dispose: vi.fn() })),
    } as unknown as import("@xterm/xterm").Terminal;
    return { term, fire: (d: string) => handler?.(d), disposers };
  }

  it("opens a command on A and records exit code on D", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A"); // prompt 1
    fire("C"); // command 1 starts
    expect(h.getCommands()).toHaveLength(1);
    expect(h.getCommands()[0].exitCode).toBeUndefined();

    fire("D;0"); // command 1 done (success)
    fire("A");   // prompt 2
    expect(h.getCommands()).toHaveLength(2);
    expect(h.getCommands()[0].exitCode).toBe(0);
  });

  it("captures a non-zero exit code", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("C");
    fire("D;1");
    expect(h.getCommands()[0].exitCode).toBe(1);
  });

  it("ignores a D with no preceding command (first precmd)", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("D;0"); // no command open yet
    expect(h.getCommands()).toHaveLength(0);
  });

  it("each command marker sits on its own line", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("D;0");
    fire("A");
    const cmds = h.getCommands();
    expect(cmds[0].marker.line).toBe(0);
    expect(cmds[1].marker.line).toBe(1);
  });

  it("removes a command when its marker is disposed (scrolled out)", () => {
    const { term, fire, disposers } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("A");
    expect(h.getCommands()).toHaveLength(2);
    disposers[0](); // first command's line scrolls out of scrollback
    expect(h.getCommands()).toHaveLength(1);
    expect(h.getCommands()[0].marker.line).toBe(1);
  });

  it("creates an exit-status decoration on D (WI-3.4)", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("C");
    fire("D;1");
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    expect(h.getCommands()[0].decoration).toBeDefined();
  });
});

describe("scrollToAdjacentCommand (WI-3.3)", () => {
  function makeTerm(viewportY: number) {
    return {
      buffer: { active: { viewportY } },
      scrollToLine: vi.fn(),
    } as unknown as import("@xterm/xterm").Terminal;
  }
  function cmds(...lines: number[]): CommandMark[] {
    return lines.map((line) => ({ marker: { line } as unknown as CommandMark["marker"] }));
  }

  it("jumps to the nearest prompt above the viewport for 'prev'", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, cmds(10, 30, 70), "prev");
    expect(term.scrollToLine).toHaveBeenCalledWith(30);
  });

  it("jumps to the nearest prompt below the viewport for 'next'", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, cmds(10, 30, 70), "next");
    expect(term.scrollToLine).toHaveBeenCalledWith(70);
  });

  it("is a no-op when there are no commands", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, [], "prev");
    expect(term.scrollToLine).not.toHaveBeenCalled();
  });

  it("ignores disposed markers (line -1)", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, cmds(-1, 30), "prev");
    expect(term.scrollToLine).toHaveBeenCalledWith(30);
  });
});
