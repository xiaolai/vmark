/**
 * Combo-box for model selection: curated suggestions + free-text input.
 *
 * For Ollama, dynamically fetches local models on first open.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { RestProviderType } from "@/types/aiGenies";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import { MODEL_SUGGESTIONS } from "./modelSuggestions";

interface ModelComboBoxProps {
  provider: RestProviderType;
  value: string;
  apiKey: string;
  endpoint: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ModelComboBox({
  provider,
  value,
  apiKey,
  endpoint,
  onChange,
  className = "",
}: ModelComboBoxProps) {
  const ime = useImeComposition();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Curated first, then fetched (deduped), always keeping curated visible
  const curated = MODEL_SUGGESTIONS[provider] ?? [];
  const curatedSet = new Set(curated);
  const merged = fetchedModels
    ? [...curated, ...fetchedModels.filter((m) => !curatedSet.has(m))]
    : curated;
  const filtered = merged.filter((m) =>
    m.toLowerCase().includes(filter.toLowerCase()),
  );

  const fetchModels = useCallback(async () => {
    setFetching(true);
    try {
      const models = await invoke<string[]>("list_models", {
        provider,
        apiKey: apiKey || null,
        endpoint: endpoint || null,
      });
      setFetchedModels(models);
    } catch {
      // Keep curated list on failure
      setFetchedModels(null);
    } finally {
      setFetching(false);
    }
  }, [provider, apiKey, endpoint]);

  // Auto-fetch on first open only for Ollama (no curated list)
  const handleOpen = useCallback(() => {
    setOpen(true);
    setFilter(value);
    setHighlightIdx(-1);
    if (provider === "ollama-api" && fetchedModels === null && !fetching) {
      fetchModels();
    }
  }, [value, fetchedModels, fetching, provider, fetchModels]);

  // Measure available space and decide drop direction
  const measureDirection = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const maxListH = 140; // ~5 items at 28px each
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setDropUp(spaceBelow < maxListH && spaceAbove > spaceBelow);
  }, []);

  // Re-measure on open
  useEffect(() => {
    if (open) measureDirection();
  }, [open, measureDirection]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: "nearest" });
  }, [highlightIdx]);

  const selectModel = (model: string) => {
    onChange(model);
    setOpen(false);
    setFilter("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        handleOpen();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIdx((i) => (i < filtered.length - 1 ? i + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIdx((i) => (i > 0 ? i - 1 : filtered.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < filtered.length) {
          selectModel(filtered[highlightIdx]);
        } else {
          setOpen(false);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setFilter("");
        break;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    setFilter(val);
    setHighlightIdx(-1);
    if (!open) handleOpen();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center gap-0.5">
        <input
          className="w-full px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-color)] border border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none font-mono"
          placeholder="Model"
          value={value}
          onChange={handleInputChange}
          onFocus={handleOpen}
          onKeyDown={handleKeyDown}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
        />
        <button
          className="shrink-0 p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-color)] hover:bg-[var(--hover-bg)] cursor-pointer focus-visible:outline-none"
          onClick={() => (open ? setOpen(false) : handleOpen())}
          title="Show models"
          tabIndex={-1}
          type="button"
        >
          <ChevronDown size={14} />
        </button>
        <button
          className="shrink-0 p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-color)] hover:bg-[var(--hover-bg)] cursor-pointer focus-visible:outline-none"
          onClick={() => {
            setFetchedModels(null);
            fetchModels();
            if (!open) handleOpen();
          }}
          title="Refresh models"
          tabIndex={-1}
          type="button"
          disabled={fetching}
        >
          {fetching ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
        </button>
      </div>

      {open && (
        <ul
          ref={listRef}
          className={`absolute z-50 left-0 right-0 max-h-[140px] overflow-y-auto rounded border border-[var(--border-color)] bg-[var(--bg-color)] shadow-[var(--popup-shadow)] text-xs ${
            dropUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          role="listbox"
        >
          {fetching && filtered.length === 0 && (
            <li className="px-2 py-1.5 text-[var(--text-tertiary)] italic">
              Loading models...
            </li>
          )}
          {!fetching && filtered.length === 0 && (
            <li className="px-2 py-1.5 text-[var(--text-tertiary)] italic">
              No models found
            </li>
          )}
          {filtered.map((model, idx) => (
            <li
              key={model}
              role="option"
              aria-selected={model === value}
              className={`px-2 py-1.5 cursor-pointer font-mono ${
                idx === highlightIdx
                  ? "bg-[var(--accent-bg)] text-[var(--accent-primary)]"
                  : model === value
                    ? "text-[var(--accent-primary)]"
                    : "text-[var(--text-color)]"
              } hover:bg-[var(--hover-bg)]`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectModel(model);
              }}
              onMouseEnter={() => setHighlightIdx(idx)}
            >
              {model}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
