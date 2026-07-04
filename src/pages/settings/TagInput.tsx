/**
 * Tag input component for managing a list of string values.
 * Used for custom link protocols.
 *
 * Part of the shared Settings UI primitives; see `components.tsx` (the
 * barrel) for the naming/decision rules that govern this family.
 */

import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";

export function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation("settings");
  // Default placeholder is translated (i18n rule: no hardcoded user-facing
  // English); callers can still override it with an already-translated string.
  const effectivePlaceholder = placeholder ?? t("tagInput.placeholder");
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ime = useImeComposition();

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue("");
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 p-2 rounded border border-[var(--border-color)]
                 bg-[var(--bg-color)] min-h-[38px] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                     bg-[var(--bg-tertiary)] text-xs text-[var(--text-color)]"
        >
          {tag}://
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-color)]
                       rounded-full focus-visible:ring-1 focus-visible:ring-[var(--primary-color)]"
            aria-label={t("removeTag", { tag })}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onBlur={() => inputValue && addTag(inputValue)}
        placeholder={value.length === 0 ? effectivePlaceholder : ""}
        className="flex-1 min-w-[100px] bg-transparent border-none outline-none
                   text-sm text-[var(--text-color)] placeholder-[var(--text-tertiary)]"
      />
    </div>
  );
}
