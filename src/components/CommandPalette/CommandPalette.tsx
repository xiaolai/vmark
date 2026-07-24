/**
 * CommandPalette — ADR-012 minimal palette UI.
 *
 * Renders an overlay with a search input + ranked command list. Reads
 * commands from CommandBus via `searchCommands(query)`; executes the
 * selected command on Enter; closes on Escape or backdrop click.
 *
 * @module components/CommandPalette/CommandPalette
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { resolveCommandContext } from "@/services/commands/commandContext";
import { buildPaletteSections, type PaletteSection } from "./paletteGrouping";

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
    // Supply the resolved command context (WI-2.1): editor commands' `when` /
    // execution need mode, document, selection, node context — not just the
    // window label. Existing window-scoped commands still read `ctx.windowLabel`.
    await executeCommand(id, null, resolveCommandContext(windowLabel));
  } catch (err) {
    menuError(`Command ${id} threw:`, err);
  }
}

/**
 * Render the palette body. Browse-mode sections get a `role="group"` wrapper
 * with an `aria-label` (screen readers announce the group on entry, WI-4.3);
 * the search-mode section (label === null) renders flat options with no header.
 * A single running index threads across all sections so `id`/`aria-selected`
 * match the flattened order the parent selects into.
 */
function renderSections(
  sections: PaletteSection[],
  selectedIndex: number,
  close: () => void,
  windowLabel: string,
  categoryLabel: (category: string) => string,
): React.ReactNode {
  let flatIndex = -1;
  return sections.map((section) => {
    const isSearchMode = section.label === null;
    const rows = section.items.map((row) => {
      flatIndex += 1;
      const i = flatIndex;
      return (
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
          {isSearchMode && row.command.category && (
            <span className="command-palette__category">
              {categoryLabel(row.command.category)}
            </span>
          )}
        </li>
      );
    });

    if (isSearchMode) return rows;

    return (
      <li
        key={`group-${section.id}`}
        role="group"
        aria-label={section.label ?? undefined}
        className="command-palette__group"
      >
        <span className="command-palette__group-label" aria-hidden="true">
          {section.label}
        </span>
        <ul className="command-palette__group-items" role="presentation">
          {rows}
        </ul>
      </li>
    );
  });
}

export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
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
  const listRef = useRef<HTMLUListElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // The context is resolved fresh on open AND on every query change (it's in the
  // memo's deps), and the palette holds focus while open, so the editor context is
  // effectively frozen — the common case stays correct. NOT yet covered: an editor
  // that mounts, or a tab that changes, while the palette sits open on an unchanged
  // query (self-corrects on the next keystroke). Execution re-resolves fresh, so a
  // stale-shown command would at worst no-op. Full store-reactive resolution is a
  // deferred palette-UX item.
  // `language` is a real (if invisible) dependency: command titles are lazy
  // i18n getters, so scoring/membership are language-sensitive. Without it a
  // language switch while the palette is open would re-render titles in the new
  // language but keep the old-language ranking (stale matches shown/hidden).
  // eslint can't see through the getters, so it reads `language` as unused here.
  const ranked: RankedCommand[] = useMemo(
    () => (isOpen ? searchCommands(query, resolveCommandContext(windowLabel)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, query, windowLabel, language],
  );

  // Localized category label, with the raw id as a defensive fallback so an
  // unlabeled category never renders blank (it degrades to its id).
  const categoryLabel = useCallback(
    (category: string) => t(`commands:category.${category}`, { defaultValue: category }),
    [t],
  );

  // Browse (empty query) → labelled sections; search → one flat ranked section
  // (WI-4.2). The sections' items, flattened in order, are the on-screen order —
  // `flat` is what selection indexes into, so grouping never desyncs the caret.
  const sections = useMemo(
    () => buildPaletteSections(ranked, query, categoryLabel, language),
    [ranked, query, categoryLabel, language],
  );
  const flat: RankedCommand[] = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  // Reset the highlighted row to the top whenever the query changes — adjusted
  // during render (React's recommended alternative to a setState-in-effect, which
  // would cost an extra render per keystroke). #1063
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedIndex(0);
  } else if (selectedIndex > 0 && selectedIndex >= flat.length) {
    // Same query, but the result set shrank (a language/context change can drop
    // rows). Clamp the caret back into range so aria-activedescendant, Enter,
    // and ArrowUp don't strand on a row that no longer exists. Guarded to the
    // out-of-range case so this render-phase adjustment can't loop. #1063
    setSelectedIndex(Math.max(0, flat.length - 1));
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

  // Keep the active row visible as the caret moves (WI-4.3) — without this,
  // arrowing into a group below the fold leaves the selection off-screen. Runs
  // on selection AND on `sections` changes (a new query re-lays-out the list).
  useEffect(() => {
    const active = listRef.current?.querySelector(
      `#command-palette-item-${selectedIndex}`,
    );
    (active as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex, sections]);

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
      setSelectedIndex((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = flat[selectedIndex]?.command;
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
          aria-expanded={flat.length > 0}
          aria-controls="command-palette-list"
          aria-activedescendant={
            selectedIndex < flat.length
              ? `command-palette-item-${selectedIndex}`
              : undefined
          }
        />
        <ul
          ref={listRef}
          className="command-palette__list"
          id="command-palette-list"
          role="listbox"
        >
          {flat.length === 0 ? (
            <li className="command-palette__empty">
              {t("commands:commandPalette.empty")}
            </li>
          ) : (
            renderSections(sections, selectedIndex, close, windowLabel, categoryLabel)
          )}
        </ul>
      </div>
    </div>
  );
}
