// WI-4.3 — Send a fenced shell block to the terminal (F1).
//
// This is the one feature that lets DOCUMENT CONTENT reach a shell, so the two
// halves of the security boundary get their own tests:
//   1. no trailing newline is ever appended (a trailing "\n" IS Enter), and
//   2. a multi-line payload is REFUSED when the shell has not enabled
//      bracketed paste — because term.paste rewrites "\n" to "\r", and without
//      bracketed paste each "\r" executes the line on arrival.
// WI-TS4.2 — delivery stays PINNED to the session id captured at request
// time: a rail switch mid-delivery must not redirect the payload.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetTerminal } = vi.hoisted(() => ({ mockGetTerminal: vi.fn() }));

vi.mock("./activeTerminal", () => ({
  getTerminalForSession: mockGetTerminal,
}));

import {
  useUIStore,
  resetTerminalSessionStore,
  MAX_TERMINAL_SESSIONS,
} from "@/stores/uiStore";
import {
  isShellLanguage,
  isTranscriptLanguage,
  extractTranscriptCommands,
  prepareShellBlock,
  isSafeToPaste,
  runInTerminal,
} from "./runInTerminal";

describe("isShellLanguage (WI-4.3)", () => {
  it.each(["bash", "sh", "zsh", "shell", "console", "shell-session", "shellsession", "terminal"])(
    "accepts %s",
    (lang) => {
      expect(isShellLanguage(lang)).toBe(true);
    },
  );

  it("is case- and whitespace-insensitive", () => {
    expect(isShellLanguage("  BASH  ")).toBe(true);
    expect(isShellLanguage("Console")).toBe(true);
  });

  it.each(["", "js", "javascript", "python", "ts", "json", "yaml", "rust", "plaintext"])(
    "rejects %j",
    (lang) => {
      expect(isShellLanguage(lang)).toBe(false);
    },
  );

  it("rejects a language that merely CONTAINS a shell name", () => {
    // "bashrc"/"powershell" are not the bash/shell fences we mean.
    expect(isShellLanguage("bashrc")).toBe(false);
    expect(isShellLanguage("powershell")).toBe(false);
  });

  it("tolerates a null/undefined info string", () => {
    expect(isShellLanguage(undefined)).toBe(false);
    expect(isShellLanguage(null)).toBe(false);
  });

  it("covers every transcript language too — the two sets cannot drift", () => {
    // SHELL_LANGUAGES is derived from the command + transcript sets, so a
    // transcript language can never be left unrunnable.
    for (const lang of ["console", "shell-session", "shellsession", "terminal"]) {
      expect(isTranscriptLanguage(lang)).toBe(true);
      expect(isShellLanguage(lang)).toBe(true);
    }
    for (const lang of ["bash", "sh", "zsh", "shell"]) {
      expect(isTranscriptLanguage(lang)).toBe(false);
      expect(isShellLanguage(lang)).toBe(true);
    }
  });
});

describe("extractTranscriptCommands (WI-4.3)", () => {
  it("keeps ONLY the prompted commands, dropping interleaved output", () => {
    // The defect this replaced: stripping the "$ " left "PASS" in the payload,
    // where it would run as a second command after the user pressed Enter.
    expect(extractTranscriptCommands("$ npm test\nPASS  src/foo.test.ts")).toBe(
      "npm test",
    );
  });

  it("keeps several commands and drops the output between them", () => {
    expect(extractTranscriptCommands("$ ls\na.txt\nb.txt\n$ pwd\n/home/me")).toBe(
      "ls\npwd",
    );
  });

  it("recognizes % (zsh) and # (root) prompts", () => {
    expect(extractTranscriptCommands("% ls\nout\n# whoami\nroot")).toBe("ls\nwhoami");
  });

  it("recognizes a prompt with leading indentation", () => {
    expect(extractTranscriptCommands("  $ ls\nout")).toBe("ls");
  });

  it("treats a prompt-less transcript as plain source rather than losing it", () => {
    // Some authors tag a bare command list `console`; dropping everything
    // would silently do nothing.
    const src = "set -euo pipefail\nmake build";
    expect(extractTranscriptCommands(src)).toBe(src);
  });

  it("does not mistake a variable or comment for a prompt", () => {
    // The trailing SPACE in the prompt pattern is what distinguishes them.
    expect(extractTranscriptCommands("$HOME/bin/tool")).toBe("$HOME/bin/tool");
    expect(extractTranscriptCommands("#!/bin/bash\n#comment")).toBe(
      "#!/bin/bash\n#comment",
    );
  });
});

describe("prepareShellBlock (WI-4.3)", () => {
  it("extracts commands only for a transcript fence", () => {
    expect(prepareShellBlock("$ ls\nout.txt", "console")).toBe("ls");
    // A `bash` fence is source, not a transcript — `$ ls` there is literal.
    expect(prepareShellBlock("$ ls", "bash")).toBe("$ ls");
  });

  it("strips trailing newlines so nothing auto-executes", () => {
    expect(prepareShellBlock("make build\n", "bash")).toBe("make build");
    expect(prepareShellBlock("make build\n\n\n", "bash")).toBe("make build");
    expect(prepareShellBlock("make build\r\n", "bash")).toBe("make build");
  });

  it("removes every carriage return, not just trailing ones", () => {
    // term.paste forwards a `\r` as an Enter press.
    expect(prepareShellBlock("a\r\nb", "bash")).toBe("a\nb");
    expect(prepareShellBlock("a\rb", "bash")).toBe("ab");
  });

  it("preserves trailing spaces on the final content line", () => {
    // Meaningful after a line continuation; stripping them changes the source.
    expect(prepareShellBlock("echo 'x'  ", "bash")).toBe("echo 'x'  ");
    expect(prepareShellBlock("echo 'x'  \n", "bash")).toBe("echo 'x'  ");
  });

  it("keeps interior newlines — a multi-line block stays multi-line", () => {
    expect(prepareShellBlock("cd /tmp\nls -la\n", "bash")).toBe("cd /tmp\nls -la");
  });

  it("keeps interior blank lines but drops trailing ones", () => {
    expect(prepareShellBlock("a\n\nb\n\n  \n", "bash")).toBe("a\n\nb");
  });

  it("returns an empty string for a blank block", () => {
    expect(prepareShellBlock("   \n\n", "bash")).toBe("");
  });
});

describe("isSafeToPaste (WI-4.3 — security boundary rule 2)", () => {
  const withMode = (bracketedPasteMode: boolean) =>
    ({ modes: { bracketedPasteMode } }) as never;

  it("allows any single-line payload regardless of bracketed paste", () => {
    expect(isSafeToPaste("make build", withMode(false))).toBe(true);
    expect(isSafeToPaste("make build", withMode(true))).toBe(true);
  });

  it("allows a multi-line payload when bracketed paste is ON", () => {
    expect(isSafeToPaste("a\nb", withMode(true))).toBe(true);
  });

  it("REFUSES a multi-line payload when bracketed paste is OFF", () => {
    // term.paste rewrites "\n" to "\r"; without bracketed paste each one is
    // an Enter press, so the block would run itself.
    expect(isSafeToPaste("a\nb", withMode(false))).toBe(false);
  });
});

describe("runInTerminal (WI-4.3)", () => {
  let paste: ReturnType<typeof vi.fn>;
  let focus: ReturnType<typeof vi.fn>;

  /** Install a terminal double with the given bracketed-paste state. */
  function installTerminal(bracketedPasteMode = true) {
    paste = vi.fn();
    focus = vi.fn();
    mockGetTerminal.mockReturnValue({ paste, focus, modes: { bracketedPasteMode } });
  }

  beforeEach(() => {
    resetTerminalSessionStore();
    if (useUIStore.getState().terminalVisible) useUIStore.getState().toggleTerminal();
    mockGetTerminal.mockReset();
    installTerminal();
  });

  it("does not append a newline — the block never auto-executes", async () => {
    useUIStore.getState().terminalCreateSession();
    await runInTerminal("rm -rf /tmp/scratch", "bash");

    expect(paste).toHaveBeenCalledTimes(1);
    const payload = paste.mock.calls[0][0] as string;
    expect(payload).toBe("rm -rf /tmp/scratch");
    expect(payload.endsWith("\n")).toBe(false);
    expect(payload).not.toContain("\r");
  });

  it("refuses a multi-line block when bracketed paste never turns on", async () => {
    useUIStore.getState().terminalCreateSession();
    installTerminal(false);
    // Drain the retry budget synchronously so the refusal is reached.
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const result = await runInTerminal("cd /tmp\nrm -rf .", "bash");

    expect(result).toEqual({ ok: false, reason: "unsafe-multiline" });
    expect(paste).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("WAITS for a starting shell to enable bracketed paste, then delivers", async () => {
    // A session created a moment ago has bracketed paste off simply because
    // its shell has not finished starting — the common "no terminal open yet"
    // path. Refusing immediately would break it.
    useUIStore.getState().terminalCreateSession();
    let calls = 0;
    paste = vi.fn();
    focus = vi.fn();
    mockGetTerminal.mockImplementation(() => ({
      paste,
      focus,
      modes: { bracketedPasteMode: ++calls >= 3 },
    }));
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const result = await runInTerminal("a\nb", "bash");

    expect(result).toEqual({ ok: true });
    expect(paste).toHaveBeenCalledWith("a\nb");
    raf.mockRestore();
  });

  it("still delivers a SINGLE-line block without bracketed paste", async () => {
    useUIStore.getState().terminalCreateSession();
    installTerminal(false);

    const result = await runInTerminal("make build", "bash");

    expect(result).toEqual({ ok: true });
    expect(paste).toHaveBeenCalledWith("make build");
  });

  it("writes a multi-line block as ONE paste, not N writes", async () => {
    useUIStore.getState().terminalCreateSession();
    await runInTerminal("a\nb\nc", "bash");
    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledWith("a\nb\nc");
  });

  it("pastes only the commands from a console transcript", async () => {
    useUIStore.getState().terminalCreateSession();
    await runInTerminal("$ npm test\nPASS", "console");
    expect(paste).toHaveBeenCalledWith("npm test");
  });

  it("creates a session when none exists", async () => {
    expect(useUIStore.getState().terminal.sessions).toHaveLength(0);
    const result = await runInTerminal("echo hi", "bash");
    expect(result.ok).toBe(true);
    expect(useUIStore.getState().terminal.sessions).toHaveLength(1);
  });

  it("reuses the active session when one exists", async () => {
    useUIStore.getState().terminalCreateSession();
    await runInTerminal("echo hi", "bash");
    expect(useUIStore.getState().terminal.sessions).toHaveLength(1);
  });

  it("delivers to the session that was ACTIVE at request time", async () => {
    // The race this closes: a deferred paste that re-resolved "the active
    // terminal" would land in whatever tab the user switched to meanwhile.
    const first = useUIStore.getState().terminalCreateSession()!;
    await runInTerminal("echo hi", "bash");
    expect(mockGetTerminal).toHaveBeenCalledWith(first.id);
  });

  it("reveals the panel", async () => {
    expect(useUIStore.getState().terminalVisible).toBe(false);
    await runInTerminal("echo hi", "bash");
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("focuses the terminal so Enter goes to the shell, not the editor", async () => {
    useUIStore.getState().terminalCreateSession();
    await runInTerminal("echo hi", "bash");
    expect(focus).toHaveBeenCalled();
  });

  it("refuses a non-shell language and pastes nothing", async () => {
    useUIStore.getState().terminalCreateSession();
    const result = await runInTerminal("print('hi')", "python");
    expect(result).toEqual({ ok: false, reason: "not-shell" });
    expect(paste).not.toHaveBeenCalled();
  });

  it("refuses an empty block and pastes nothing", async () => {
    useUIStore.getState().terminalCreateSession();
    const result = await runInTerminal("   \n  ", "bash");
    expect(result).toEqual({ ok: false, reason: "empty" });
    expect(paste).not.toHaveBeenCalled();
  });

  it("reuses the existing session at the cap instead of failing", async () => {
    // The cap only blocks CREATING a session. With five open, the active one
    // is a perfectly good target — refusing here would be a bug.
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      useUIStore.getState().terminalCreateSession();
    }
    const result = await runInTerminal("echo hi", "bash");
    expect(result).toEqual({ ok: true });
    expect(useUIStore.getState().terminal.sessions).toHaveLength(MAX_TERMINAL_SESSIONS);
  });

  it("reports paste-failed rather than claiming success", async () => {
    useUIStore.getState().terminalCreateSession();
    paste.mockImplementation(() => {
      throw new Error("terminal disposed mid-paste");
    });
    const result = await runInTerminal("echo hi", "bash");
    expect(result).toEqual({ ok: false, reason: "paste-failed" });
  });

  it("reports a timeout when the session's terminal never mounts", async () => {
    // Previously this returned ok:true and silently dropped the payload.
    useUIStore.getState().terminalCreateSession();
    mockGetTerminal.mockReturnValue(null);
    // Drive rAF synchronously so the bounded retry drains immediately.
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const result = await runInTerminal("echo hi", "bash");

    expect(result).toEqual({ ok: false, reason: "timeout" });
    raf.mockRestore();
  });

  it("delivers once the terminal appears on a later frame", async () => {
    // A freshly created session's xterm mounts in a React effect, so the
    // first resolve attempt legitimately finds nothing.
    useUIStore.getState().terminalCreateSession();
    let calls = 0;
    mockGetTerminal.mockImplementation(() =>
      ++calls < 3 ? null : { paste, focus, modes: { bracketedPasteMode: true } },
    );
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const result = await runInTerminal("echo hi", "bash");

    expect(result).toEqual({ ok: true });
    expect(paste).toHaveBeenCalledWith("echo hi");
    raf.mockRestore();
  });
});

describe("id-pinned delivery across a rail switch (WI-TS4.2, D-T10)", () => {
  beforeEach(() => {
    resetTerminalSessionStore();
    if (useUIStore.getState().terminalVisible) useUIStore.getState().toggleTerminal();
    mockGetTerminal.mockReset();
  });

  it("delivers to the ORIGINALLY targeted session after the visible scope swaps mid-delivery", async () => {
    const first = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    const paste = vi.fn();
    const focus = vi.fn();
    let frames = 0;
    // The terminal only becomes reachable a few frames in — the window in
    // which a real user can click another workspace on the rail.
    mockGetTerminal.mockImplementation(() =>
      ++frames >= 3 ? { paste, focus, modes: { bracketedPasteMode: true } } : null,
    );

    const pending = runInTerminal("make build", "bash");
    // Rail switch lands mid-delivery: A's scope hides, nothing is active.
    useUIStore.getState().terminalSwitchScope("wsi-a", "wsi-b");
    expect(useUIStore.getState().terminal.activeSessionId).toBeNull();

    const result = await pending;

    expect(result).toEqual({ ok: true });
    expect(mockGetTerminal).toHaveBeenLastCalledWith(first.id);
    expect(paste).toHaveBeenCalledWith("make build");
  });
});
