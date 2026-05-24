/**
 * Typed theme tokens — ADR-014.
 *
 * The canonical type for visual design tokens. Themes implement this type;
 * the reskin replaces a theme by providing a new `ThemeTokens` value rather
 * than editing CSS.
 *
 * This file is foundation-only: it defines the type and shipping light/dark
 * implementations. The existing `useTheme.ts` runtime CSS-var writer continues
 * to own runtime overrides driven by user settings; migrating that layer to
 * consume from this typed structure is a follow-up.
 *
 * Values mirror `src/styles/index.css` so the typed structure is the
 * authoritative shape going forward; ad-hoc CSS-var additions in index.css
 * should also be added here.
 *
 * @module theme/tokens
 */

export type ThemeTokens = {
  color: {
    bg: { primary: string; secondary: string; tertiary: string };
    text: { primary: string; secondary: string; tertiary: string };
    accent: { primary: string; bg: string };
    border: string;
    selection: string;
    semantic: {
      error: string;
      errorBg: string;
      errorHover: string;
      warning: string;
      warningBg: string;
      success: string;
      successHover: string;
    };
    alert: {
      note: string;
      tip: string;
      important: string;
      warning: string;
      caution: string;
    };
    media: {
      video: string;
      audio: string;
      youtube: string;
      vimeo: string;
      bilibili: string;
    };
  };
  space: Record<1 | 2 | 3 | 4 | 5 | 6 | 8 | 10, string>;
  radius: { sm: string; md: string; lg: string; pill: string };
  shadow: { sm: string; md: string; popup: string };
  font: { sans: string; mono: string };
};

export const lightTheme: ThemeTokens = {
  color: {
    bg: { primary: "#eeeded", secondary: "#e5e4e4", tertiary: "#f0f0f0" },
    text: { primary: "#1a1a1a", secondary: "#666666", tertiary: "#999999" },
    accent: { primary: "#0066cc", bg: "rgba(0, 102, 204, 0.1)" },
    border: "#d5d4d4",
    selection: "rgba(0, 102, 204, 0.2)",
    semantic: {
      error: "#cf222e",
      errorBg: "#ffebe9",
      errorHover: "#b91c1c",
      warning: "#9a6700",
      warningBg: "rgba(245, 158, 11, 0.1)",
      success: "#16a34a",
      successHover: "#15803d",
    },
    alert: {
      note: "#0969da",
      tip: "#1a7f37",
      important: "#8250df",
      warning: "#9a6700",
      caution: "#cf222e",
    },
    media: {
      video: "#0d9488",
      audio: "#6366f1",
      youtube: "#dc2626",
      vimeo: "#00adef",
      bilibili: "#fb7299",
    },
  },
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
  },
  radius: { sm: "4px", md: "6px", lg: "8px", pill: "100px" },
  shadow: {
    sm: "0 1px 3px rgba(0, 0, 0, 0.1)",
    md: "0 2px 8px rgba(0, 0, 0, 0.12)",
    popup: "0 4px 12px rgba(0, 0, 0, 0.15)",
  },
  font: {
    sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "SF Pro SC", "SF Pro Text", "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Helvetica, Arial, sans-serif',
    mono: '"SauceCodePro NF", "Courier New", Consolas, monospace',
  },
};

export const darkTheme: ThemeTokens = {
  ...lightTheme,
  color: {
    ...lightTheme.color,
    bg: { primary: "#1e1e1e", secondary: "#252525", tertiary: "#2a2a2a" },
    text: { primary: "#e8e8e8", secondary: "#858585", tertiary: "#6a6a6a" },
    border: "#3a3a3a",
    accent: { primary: "#58a6ff", bg: "rgba(88, 166, 255, 0.12)" },
    selection: "rgba(88, 166, 255, 0.2)",
    semantic: {
      ...lightTheme.color.semantic,
      error: "#f85149",
      errorBg: "rgba(248, 81, 73, 0.15)",
      success: "#4ade80",
    },
    alert: {
      note: "#58a6ff",
      tip: "#3fb950",
      important: "#a371f7",
      warning: "#d29922",
      caution: "#f85149",
    },
    media: {
      video: "#2dd4bf",
      audio: "#818cf8",
      youtube: "#f87171",
      vimeo: "#4ac3f0",
      bilibili: "#fc9cb5",
    },
  },
  shadow: {
    ...lightTheme.shadow,
    popup: "0 4px 12px rgba(0, 0, 0, 0.4)",
  },
};
