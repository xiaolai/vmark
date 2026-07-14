/**
 * CommandPalette — ADR-012 minimal palette UI.
 *
 * Renders an overlay with a search input + ranked command list. Reads
 * commands from CommandBus via `searchCommands(query)`; executes the
 * selected command on Enter; closes on Escape or backdrop click.
 *
 * @module components/CommandPalette/CommandPalette
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  executeCommand,
  searchCommands,
  resolveLocalizedString,
  type RankedCommand,
} from "@/services/commands";
import { useCommandPaletteStore } from "./commandPaletteStore";
import { menuError } from "@/utils/debug";
import { isImeKeyEvent } from "@/utils/imeGuard";
import "./command-palette.css";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";
import { useWindowLabel } from "@/contexts/WindowContext";

/**
 * Run a command without swallowing its errors. Awaits the result and
 * logs (rather than crashes the palette) on rejection so an action
 * failure never produces an unhandled promise rejection.
 *
 * The invoking window's label rides in the context (WI-S0.7). Without it,
 * a window-scoped command falls back to "main" — so invoking "New Browser Tab"
 * from a second document window opened the tab in the FIRST one.
 */
async function runCommand(id: string, windowLabel: string): Promise<void> {
  try {
    await executeCommand(id, null, { windowLabel });
  } catch (err) {
    menuError(`Command ${id} threw:`, err);
  }
}

export function CommandPalette() {
  const { t } = useTranslation();
  const windowLabel = useWindowLabel();
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  // The native browser view paints over all React DOM in its rect, so freeze every
  // mounted browser tab while this overlay is up (WI-SOC.1).
  useBrowserOccluder(isOpen, "command-palette");
  const close = useCommandPaletteStore((s) => s.close);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  const ranked: RankedCommand[] = useMemo(
    () => (isOpen ? searchCommands(query, { windowLabel }) : []),
    [isOpen, query, windowLabel],
  );

  // Reset the highlighted row to the top whenever the query changes — adjusted
  // during render (React's recommended alternative to a setState-in-effect, which
  // would cost an extra render per keystroke). #1063
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  // Reset and focus on open; restore previous focus on close (a11y). Legitimate
  // setState-in-effect: bound to the open/close transition and bundled with focus
  // capture/restore + RAF focus, not derivable during render (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      setQuery("");
      setSelectedIndex(0);
      // Focus the input after the next render frame so the autoFocus
      // lands after the overlay paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (previousFocusRef.current) {
      const el = previousFocusRef.current as HTMLElement;
      if (typeof el.focus === "function") el.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen) return null;

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    // Suppress key handling during IME composition so CJK input
    // doesn't accidentally fire commands on Enter.
    /* v8 ignore next -- @preserve IME guard not reachable in jsdom */
    if (isImeKeyEvent(e.nativeEvent as KeyboardEvent)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(0, ranked.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = ranked[selectedIndex]?.command;
      if (picked) {
        close();
        await runCommand(picked.id, windowLabel);
      }
      return;
    }
  };

  return (
    <div
      className="command-palette__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("commands:aria.commandPalette")}
      >
        <input
          ref={inputRef}
          className="command-palette__input"
          type="text"
          value={query}
          placeholder={t("commands:commandPalette.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={ranked.length > 0}
          aria-controls="command-palette-list"
          aria-activedescendant={
            ranked.length > 0 ? `command-palette-item-${selectedIndex}` : undefined
          }
        />
        <ul className="command-palette__list" id="command-palette-list" role="listbox">
          {ranked.length === 0 ? (
            <li className="command-palette__empty">
              {t("commands:commandPalette.empty")}
            </li>
          ) : (
            ranked.map((row, i) => (
              <li
                key={row.command.id}
                role="option"
                id={`command-palette-item-${i}`}
                aria-selected={i === selectedIndex}
                className={`command-palette__row${i === selectedIndex ? " is-selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  close();
                  void runCommand(row.command.id, windowLabel);
                }}
              >
                <span className="command-palette__title">
                  {resolveLocalizedString(row.command.title)}
                </span>
                {row.command.category && (
                  <span className="command-palette__category">{row.command.category}</span>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
