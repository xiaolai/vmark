/**
 * ThemedToaster
 *
 * Purpose: the app's sonner mount, themed. Sonner defaults to its LIGHT card
 * (`--normal-bg` #fff, its own font) regardless of the app theme — every toast
 * on night was a white rectangle (WI-UI1.6). The token mapping lives in
 * `index.css` (`[data-sonner-toaster]`); this component supplies the
 * light/dark switch sonner needs to pick its base palette.
 *
 * @module components/ThemedToaster
 */
import { Toaster } from "sonner";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { TOAST_ICONS } from "@/components/toastIcons";

export function ThemedToaster() {
  const isDark = useIsDarkTheme();
  return (
    <Toaster position="top-center" closeButton icons={TOAST_ICONS} theme={isDark ? "dark" : "light"} />
  );
}
