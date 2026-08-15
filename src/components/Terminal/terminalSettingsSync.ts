/**
 * terminalSettingsSync — apply live terminal-setting changes to running xterms.
 *
 * Split out of `terminalSessionStoreSync.ts`, which held three unrelated
 * subscribe effects (theme, workspace root, settings) and had grown past the
 * 300-line limit. This one is purely "a setting changed → update the options of
 * every live session", with no workspace or theme concern in it.
 *
 * Normalisation is deliberately NOT re-derived here: `clampScrollback` and
 * `clampContrastRatio` come from `terminalOptions.ts`, the same functions
 * creation uses. They were duplicated once and drifted — the copies clamped the
 * range but let NaN and fractional values through, and xterm throws on a NaN
 * scrollback (audit 20260815-163607 #16).
 *
 * @coordinates-with terminalSessionStoreSync.ts — sibling effects, one caller
 * @coordinates-with terminalOptions.ts — the shared normalizers
 * @module components/Terminal/terminalSettingsSync
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import type { SyncableSessionEntry } from "./terminalSessionTypes";
import { fitAndResizePty } from "./fitAndResizePty";
import { clampContrastRatio, clampScrollback } from "./terminalOptions";

/** Subscribe live sessions to terminal-setting changes. */
export function useTerminalSettingsSync(
  sessionsRef: React.RefObject<Map<string, SyncableSessionEntry>>,
): void {
useEffect(() => {
  // `prev` comes from zustand, not a hand-rolled ref. The previous manual
  // version carried `if (!curr || !prev) { prev = curr; return; }`, which
  // could strand the baseline: one falsy `curr` set `prev = undefined`, and
  // the next fire then took the same branch and swallowed a REAL change —
  // permanently, since the fire after that compared against the
  // already-applied value. Letting the store supply prev removes the state
  // that could get stranded.
  return useSettingsStore.subscribe((state, prevState) => {
    const curr = state.terminal;
    const prev = prevState.terminal;
    if (!curr || !prev || curr === prev) return;
    const fontChanged = curr.fontSize !== prev.fontSize || curr.lineHeight !== prev.lineHeight;
    const cursorChanged = curr.cursorStyle !== prev.cursorStyle || curr.cursorBlink !== prev.cursorBlink;
    const metaChanged = curr.macOptionIsMeta !== prev.macOptionIsMeta;
    const screenReaderChanged = curr.screenReaderMode !== prev.screenReaderMode;
    const scrollbackChanged = curr.scrollback !== prev.scrollback;
    const contrastChanged = curr.minimumContrastRatio !== prev.minimumContrastRatio;
    if (!fontChanged && !cursorChanged && !metaChanged && !screenReaderChanged && !scrollbackChanged && !contrastChanged) return;

    const sessions = sessionsRef.current;
    if (!sessions) return;
    for (const [, entry] of sessions) {
      const opts = entry.instance.term.options;
      if (fontChanged) {
        opts.fontSize = curr.fontSize;
        opts.lineHeight = curr.lineHeight;
      }
      if (cursorChanged) {
        opts.cursorStyle = curr.cursorStyle;
        opts.cursorBlink = curr.cursorBlink;
      }
      if (metaChanged) {
        opts.macOptionIsMeta = curr.macOptionIsMeta;
      }
      if (screenReaderChanged) {
        opts.screenReaderMode = curr.screenReaderMode;
      }
      if (scrollbackChanged) {
        // The SAME normalizers creation uses, not a second copy of the rule.
        // The copies had already drifted: this path clamped the range but let
        // NaN and fractional values through, and xterm throws on a NaN
        // scrollback (audit 20260815-163607 #16).
        opts.scrollback = clampScrollback(curr.scrollback);
      }
      if (contrastChanged) {
        opts.minimumContrastRatio = clampContrastRatio(curr.minimumContrastRatio);
      }
      if (fontChanged) {
        // Font metrics changed, so cols/rows changed — the PTY must be told,
        // not just xterm. A bare fitAddon.fit() here left the shell drawing
        // to the old width until an unrelated panel resize happened to
        // correct it.
        fitAndResizePty(entry);
      }
    }
  });
}, [sessionsRef]);}
