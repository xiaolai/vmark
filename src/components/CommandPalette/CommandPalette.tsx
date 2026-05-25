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

/**
 * Run a command without swallowing its errors. Awaits the result and
 * logs (rather than crashes the palette) on rejection so an action
 * failure never produces an unhandled promise rejection.
 */
async function runCommand(id: string): Promise<void> {
  try {
    await executeCommand(id);
  } catch (err) {
    menuError(`Command ${id} threw:`, err);
  }
}

export function CommandPalette() {
  const { t } = useTranslation();
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const close = useCommandPaletteStore((s) => s.close);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const ranked: RankedCommand[] = useMemo(
    () => (isOpen ? searchCommands(query) : []),
    [isOpen, query],
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      // Focus the input after the next render frame so the autoFocus
      // lands after the overlay paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
        await runCommand(picked.id);
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
      <div className="command-palette" role="dialog" aria-label={t("commands:aria.commandPalette")}>
        <input
          ref={inputRef}
          className="command-palette__input"
          type="text"
          value={query}
          placeholder={t("commands:commandPalette.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <ul className="command-palette__list" role="listbox">
          {ranked.length === 0 ? (
            <li className="command-palette__empty">
              {t("commands:commandPalette.empty")}
            </li>
          ) : (
            ranked.map((row, i) => (
              <li
                key={row.command.id}
                role="option"
                aria-selected={i === selectedIndex}
                className={`command-palette__row${i === selectedIndex ? " is-selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  close();
                  void runCommand(row.command.id);
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
