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
  /** Forwarded so SettingRow's label htmlFor wiring reaches the control. */
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

// WI-UI2.4: Button is a THIN WRAPPER over `.vm-btn` (button-shared.css).
// primary maps to the solid CTA, danger to the outlined danger; warning and
// success have no canonical variant, so they keep a tint layered on the
// canonical SHAPE (the shape is the thing that drifted).
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "vm-btn--cta",
  secondary: "",
  tertiary: "vm-btn--plain",
  danger: "vm-btn--danger",
  warning: "bg-[var(--warning-color)]! text-[var(--contrast-text)]! hover:opacity-90",
  success: "bg-[var(--success-color)]! text-[var(--contrast-text)]! hover:opacity-90",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "vm-btn--compact",
  md: "",
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
  id,
  ...ariaProps
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
      id={id}
      {...ariaProps}
      className={`vm-btn ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`.replace(/\s+/g, " ").trim()}
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
  className?: string;
}

export function CopyButton({ text, className = "" }: CopyButtonProps) {
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


  return (
    <button
      onClick={(e) => void handleCopy(e)}
      className={`vm-icon-btn vm-icon-btn--sm ${className}`.trim()}
      title={copied ? t("copied") : t("copy")}
      aria-label={copied ? t("copied") : t("copy")}
    >
      {copied ? (
        // Glyph size comes from the unlayered `.vm-icon-btn svg` rule (14px);
        // a layered Tailwind w-*/h-* utility here can never win and only
        // misleads (audit round 2, finding 29).
        <svg className="text-[var(--success-color)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      className={`vm-icon-btn vm-icon-btn--sm ${className}`.trim()}
      title={t("close")}
      aria-label={t("close")}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
