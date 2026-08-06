/**
 * #1176 — what the key handler does while a Chinese IME owns the keyboard.
 *
 * Root-caused from a live macOS Shuangpin trace: every keydown carries keyCode
 * 229 while the IME is active. The handler's job in that state is T2 (Channel
 * Ownership) — CONSUME those keydowns (return false) so xterm's `_keyDown`
 * never reaches `_handleAnyTextareaChanges`, whose snapshot-and-DEL is the
 * gate design's one remaining hazard. It does NOT write the character: the
 * character reaches the PTY through the gate's container `input`/composition
 * path, and returning false without `preventDefault` leaves that DOM event
 * free to fire. See the T2 comment in `terminalKeyHandler.ts`.
 *
 * An earlier draft of this suite asserted the opposite — that the handler
 * writes `/`, the digits and their shifted punctuation itself. That was a
 * candidate design for #1176 which was not the one adopted (the fix,
 * 271c044d, changed this file by one blank comment line; its ~84 real lines
 * went into the GATE), so the assertions described behaviour no code had.
 * They are removed rather than skipped: a test for a rejected design is not
 * pending work, it is a false description of the system.
 *
 * WHERE #1176 IS ACTUALLY COVERED, and where it is NOT:
 *   - `imeAsciiHandoff.test.ts` wires the REAL handler to the REAL gate and
 *     replays the RECORDED event order (insert before its own keydown),
 *     asserting the slash, the digits and shifted punctuation each reach the
 *     PTY exactly once. That is the delivery proof.
 *   - No tier drives a real OS IME in the TERMINAL. The WebKit tier says so
 *     itself — it can drive ASCII and direct non-ASCII insertion, not a
 *     macOS Pinyin candidate cycle — and `pnpm e2e:ime` focuses
 *     `.ProseMirror`, never the terminal. So every check above is synthetic
 *     in its event shape. If an affected IME emits no `input` event at all,
 *     the key is still lost by construction and nothing here would notice.
 *     Stating that plainly is the point: an earlier version of this comment
 *     claimed those two tiers covered it, which is the same false
 *     description the deleted tests were removed for.
 *
 * Split from terminalKeyHandler.test.ts, which is at its frozen size baseline.
 */
import { describe, it, expect, vi } from "vitest";

// No store mocks: `lint:mock-boundaries` forbids mocking app state, and the
// real stores already default to exactly what these paths need — an empty
// terminal session list and `Ctrl-\`` for toggleTerminal. Reading the real
// defaults is also strictly better coverage: a mocked store cannot notice
// when the store's own shape or default changes underneath the handler.
// (The sibling suite's mocks predate the gate and are baselined; the
// baseline ratchets DOWN only, so a split file may not re-add them.)

vi.mock("@/services/terminal/terminalGate", () => ({ requestToggleTerminal: vi.fn() }));

import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";
import { createTerminalKeyHandler } from "./terminalKeyHandler";

function makeTerm(): Terminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
  } as unknown as Terminal;
}

describe("createTerminalKeyHandler — keys the IME passed through (#1176)", () => {
  function makeHandler(isComposing: () => boolean = () => false) {
    const write = vi.fn();
    const ptyRef = { current: { write } as unknown as IPty };
    const handler = createTerminalKeyHandler(makeTerm(), ptyRef, {
      onSearch: vi.fn(),
      isComposing,
    });
    return Object.assign(handler, { write });
  }

  function imeKeydown(key: string, over: Partial<KeyboardEvent> = {}) {
    return {
      type: "keydown",
      key,
      keyCode: 229,
      code: "",
      isComposing: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...over,
    } as unknown as KeyboardEvent;
  }

  // The T2 contract: consumed (false) so xterm never sees it, and NOT written
  // here — the gate's input path owns delivery.
  it.each(["/", "1", "9", "!", "@", "-", "=", "."])(
    "consumes %s without writing it, leaving delivery to the gate",
    (key) => {
      const handler = makeHandler();
      expect(handler(imeKeydown(key))).toBe(false);
      expect(handler.write).not.toHaveBeenCalled();
    },
  );

  it("still consumes the keydown when the PTY is gone", () => {
    // Asserting only "does not throw" was vacuous: the 229 branch returns
    // before it ever consults `ptyRef`, so it passed with a live PTY too.
    // The property that matters is that a dead PTY does not change the
    // channel decision — xterm must still not see the keydown.
    const handler = createTerminalKeyHandler(makeTerm(), { current: null }, {
      onSearch: vi.fn(),
      isComposing: () => false,
    });
    expect(handler(imeKeydown("/"))).toBe(false);
  });

  it.each(["a", "n", "z"])("consumes the letter %s WITHOUT writing (it starts a composition)", (key) => {
    const handler = makeHandler();
    expect(handler(imeKeydown(key))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it("consumes a digit WITHOUT writing while composing (candidate selection)", () => {
    const handler = makeHandler(() => true); // isComposing
    expect(handler(imeKeydown("2"))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it("consumes a digit whose event reports isComposing, without writing", () => {
    const handler = makeHandler();
    expect(handler(imeKeydown("2", { isComposing: true }))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it("consumes a named IME key without writing", () => {
    const handler = makeHandler();
    expect(handler(imeKeydown("Process"))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
  ])("%s+1 is a host chord, not shell input", (_label, mods) => {
    const handler = makeHandler();
    expect(handler(imeKeydown("1", mods))).toBe(false);
    expect(handler.write).not.toHaveBeenCalled();
  });
});
