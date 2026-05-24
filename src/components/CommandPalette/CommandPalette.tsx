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
  type RankedCommand,
} from "@/services/commands";
import { useCommandPaletteStore } from "./commandPaletteStore";
import "./command-palette.css";

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        void executeCommand(picked.id);
        close();
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
      <div className="command-palette" role="dialog" aria-label={t("aria.commandPalette", { defaultValue: "Command palette" })}>
        <input
          ref={inputRef}
          className="command-palette__input"
          type="text"
          value={query}
          placeholder={t("commandPalette.placeholder", { defaultValue: "Type a command" })}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <ul className="command-palette__list" role="listbox">
          {ranked.length === 0 ? (
            <li className="command-palette__empty">
              {t("commandPalette.empty", { defaultValue: "No matching commands" })}
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
                  void executeCommand(row.command.id);
                  close();
                }}
              >
                <span className="command-palette__title">{row.command.title}</span>
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
