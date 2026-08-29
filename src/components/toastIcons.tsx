/**
 * Purpose: the icon set sonner's `<Toaster>` renders per toast severity.
 *
 * Extracted from `App.tsx`, which is the document window's composition root and
 * sits at the 300-line limit — an explanatory comment on one icon was enough to
 * push it over. A severity→icon map is data, not composition, so it does not
 * belong in the root anyway.
 *
 * @coordinates-with src/App.tsx — the sole consumer, passed as `<Toaster icons>`
 * @module components/toastIcons
 */

import { CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

const SIZE = 16;

export const TOAST_ICONS = {
  success: <CheckCircle size={SIZE} />,
  // AlertCircle, not XCircle: an X-in-a-circle reads as a second (and larger)
  // close button beside sonner's own `closeButton`. Keeping the severity ramp
  // as i / ! / ⚠ leaves the X shape unique to dismissal.
  error: <AlertCircle size={SIZE} />,
  info: <Info size={SIZE} />,
  warning: <AlertTriangle size={SIZE} />,
  loading: <span className="vm-spinner" />,
};
