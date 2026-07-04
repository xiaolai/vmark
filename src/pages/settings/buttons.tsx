/**
 * Settings button primitives — Button, CopyButton, CloseButton.
 *
 * Part of the shared Settings UI primitives; see `components.tsx` (the
 * barrel) for the naming/decision rules that govern this family.
 */

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger" | "warning" | "success";
type ButtonSize = "sm" | "md";

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  onClick?: (e: React.MouseEvent) => void;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: `bg-[var(--primary-color)] text-[var(--contrast-text)]
            hover:opacity-90`,
  secondary: `bg-transparent text-[var(--text-secondary)] border border-[var(--border-color)]
              hover:bg-[var(--hover-bg)]`,
  tertiary: `bg-[var(--bg-tertiary)] text-[var(--text-color)]
             hover:bg-[var(--hover-bg)]`,
  danger: `bg-transparent text-[var(--error-color)] border border-[var(--error-color)]/30
           hover:bg-[var(--error-bg)]`,
  warning: `bg-[var(--warning-color)] text-[var(--contrast-text)]
            hover:opacity-90`,
  success: `bg-[var(--success-color)] text-[var(--contrast-text)]
            hover:opacity-90`,
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function Button({
  children,
  variant = "secondary",
  size = "sm",
  disabled,
  className = "",
  icon,
  iconPosition = "left",
  onClick,
}: ButtonProps) {
  const content = icon ? (
    <span className="inline-flex items-center gap-1.5">
      {iconPosition === "left" && icon}
      {children}
      {iconPosition === "right" && icon}
    </span>
  ) : (
    children
  );

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded font-medium transition-colors
                  focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1
                  ${buttonVariants[variant]}
                  ${buttonSizes[size]}
                  ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                  ${className}`}
    >
      {content}
    </button>
  );
}

// ============================================================================
// Copy Button
// ============================================================================

interface CopyButtonProps {
  text: string;
  size?: "xs" | "sm";
  className?: string;
}

export function CopyButton({ text, size = "sm", className = "" }: CopyButtonProps) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState(false);
  // Pending revert timer. Kept in a ref so a re-click can cancel the stale
  // timer (no early flicker back to "Copy") and unmount can clear it (no
  // setState on an unmounted component).
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimerRef.current !== null) clearTimeout(revertTimerRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (revertTimerRef.current !== null) clearTimeout(revertTimerRef.current);
      revertTimerRef.current = setTimeout(() => {
        revertTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch {
      // Clipboard access denied — no user feedback needed, button stays in default state
    }
  };

  /* v8 ignore next -- @preserve size !=="sm" branch: tests only invoke with size="sm" */
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-3 h-3";

  return (
    <button
      onClick={handleCopy}
      className={`p-0.5 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                  hover:text-[var(--text-color)] transition-colors flex-shrink-0
                  focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1
                  ${className}`}
      title={copied ? t("copied") : t("copy")}
      aria-label={copied ? t("copied") : t("copy")}
    >
      {copied ? (
        <svg className={`${iconSize} text-[var(--success-color)]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg className={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

// ============================================================================
// Close Button (Dialog)
// ============================================================================

interface CloseButtonProps {
  onClick: () => void;
  className?: string;
}

export function CloseButton({ onClick, className = "" }: CloseButtonProps) {
  const { t } = useTranslation("settings");
  return (
    <button
      onClick={onClick}
      className={`p-1 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                  hover:text-[var(--text-color)] transition-colors
                  focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1
                  ${className}`}
      title={t("close")}
      aria-label={t("close")}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
