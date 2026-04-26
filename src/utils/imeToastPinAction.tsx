/**
 * Pin Action Builder
 *
 * Purpose: Builds the sonner action object that turns a toast into a "pin"
 * button — clicking it re-fires the toast with duration: Infinity so the
 * user can read long messages at their own pace before dismissing.
 *
 * Why a separate file: imeToast.ts is logic-only (.ts), but the action's
 * `label` is JSX (the Pin lucide icon). Splitting JSX into a .tsx keeps the
 * core wrapper free of React imports.
 *
 * Why we import i18next directly instead of `@/i18n`: our `src/i18n.ts`
 * wrapper imports `safeStorage` / `workspaceStorage` / `settingsStore` to
 * register translation resolvers, and those modules toast via `imeToast` →
 * `imeToastPinAction`. Routing this file through `@/i18n` closed that loop
 * into a circular dep flagged by depcruise. The `i18next` singleton is the
 * same instance, just imported without forming the cycle.
 *
 * @coordinates-with utils/imeToast.ts — invokes this builder when callers
 *   pass `{ pin: true }` and no explicit action of their own.
 * @module utils/imeToastPinAction
 */

import type React from "react";
import { Pin } from "lucide-react";
import { toast } from "sonner";
import i18next from "i18next";

type ToastFn = typeof toast.error;
type ToastMessage = Parameters<ToastFn>[0];
type ExternalToast = NonNullable<Parameters<ToastFn>[1]>;
type ToastId = string | number;

/**
 * Build a sonner Action that, when clicked, replaces the toast with an
 * infinite-duration version (sonner uses the `id` to update in place).
 *
 * Note: `toastId` is forwarded with its original type. Sonner treats string
 * and number ids as distinct namespaces — coercing here would create a new
 * toast on pin click instead of replacing the original.
 */
export function buildPinAction(
  fn: ToastFn,
  message: ToastMessage,
  passthroughOpts: ExternalToast,
  toastId: ToastId,
): { label: React.ReactNode; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void } {
  return {
    label: (
      <Pin
        size={14}
        aria-label={i18next.t("dialog:common.pin")}
        // Title gives a hover tooltip — discoverable for first-time users.
        // The icon button itself is sonner's; we just decorate the label.
      />
    ),
    onClick: (event) => {
      // Action buttons in sonner v2 do not auto-dismiss, but stop propagation
      // anyway in case future versions or wrappers behave differently.
      event.preventDefault();
      // Re-fire the same toast id with infinity → sonner replaces in place.
      // We forward the original options so type/icon/styling is preserved.
      fn(message, {
        ...passthroughOpts,
        id: toastId,
        duration: Number.POSITIVE_INFINITY,
      });
    },
  };
}
