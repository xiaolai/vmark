import { useEffect } from "react";
import { useSettingsStore, themes, type ThemeColors } from "@/stores/settingsStore";

const fontStacks = {
  latin: {
    system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    athelas: "Athelas, Georgia, serif", // Apple Books default
    palatino: "Palatino, 'Palatino Linotype', serif",
    georgia: "Georgia, 'Times New Roman', serif",
    charter: "Charter, Georgia, serif",
    literata: "Literata, Georgia, serif", // Google reading font
  },
  cjk: {
    system: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    pingfang: '"PingFang SC", "PingFang TC", sans-serif', // Apple Books
    songti: '"Songti SC", "STSong", "SimSun", serif',
    kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif',
    notoserif: '"Noto Serif CJK SC", "Source Han Serif SC", serif',
    sourcehans: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
  },
  mono: {
    system: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    firacode: '"Fira Code", ui-monospace, monospace',
    jetbrains: '"JetBrains Mono", ui-monospace, monospace',
    sourcecodepro: '"Source Code Pro", ui-monospace, monospace',
    consolas: 'Consolas, "Courier New", monospace',
    inconsolata: 'Inconsolata, ui-monospace, monospace',
  },
};

/** Light mode color defaults */
const lightModeColors = {
  "--text-secondary": "#666666",
  "--code-text-color": "#1a1a1a",
  "--selection-color": "rgba(0, 102, 204, 0.2)",
  "--md-char-color": "#777777",
  "--meta-content-color": "#777777",
  "--strong-color": "rgb(63, 86, 99)",
  "--emphasis-color": "rgb(91, 4, 17)",
  "--blur-text-color": "#c8c8c8",
  "--text-tertiary": "#999999",
  "--accent-bg": "rgba(0, 102, 204, 0.1)",
  "--source-mode-bg": "rgba(0, 0, 0, 0.02)",
  "--error-color": "#cf222e",
  "--error-bg": "#ffebe9",
};

/** Dark mode color defaults */
const darkModeColors = {
  "--text-secondary": "#858585",
  "--code-text-color": "#d6d9de", // Falls back to foreground
  "--selection-color": "rgba(79, 193, 255, 0.2)",
  "--md-char-color": "#6a9955",
  "--meta-content-color": "#6a9955",
  "--strong-color": "#569cd6",
  "--emphasis-color": "#ce9178",
  "--blur-text-color": "#6b7078",
  "--bg-tertiary": "#32363d",
  "--text-tertiary": "#6b7078",
  "--accent-bg": "rgba(90, 168, 255, 0.12)",
  "--source-mode-bg": "rgba(255, 255, 255, 0.02)",
  "--error-color": "#f85149",
  "--error-bg": "rgba(248, 81, 73, 0.15)",
};

/** Apply CSS variables from a config object */
function applyVars(root: HTMLElement, vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

/** Apply core theme colors (background, foreground, accents) */
function applyCoreColors(root: HTMLElement, colors: ThemeColors) {
  applyVars(root, {
    "--bg-color": colors.background,
    "--text-color": colors.foreground,
    "--primary-color": colors.link,
    "--bg-secondary": colors.secondary,
    "--border-color": colors.border,
    "--accent-primary": colors.link,
    "--accent-text": colors.link,
    "--sidebar-bg": colors.secondary,
    "--code-bg-color": colors.secondary,
    "--code-border-color": colors.border,
    "--table-border-color": colors.border,
  });
}

/** Apply mode-specific colors (dark/light) */
function applyModeColors(root: HTMLElement, colors: ThemeColors, isDark: boolean) {
  if (isDark) {
    applyVars(root, {
      "--text-secondary": colors.textSecondary ?? darkModeColors["--text-secondary"],
      "--code-text-color": colors.codeText ?? colors.foreground,
      "--selection-color": colors.selection ?? darkModeColors["--selection-color"],
      "--md-char-color": colors.mdChar ?? darkModeColors["--md-char-color"],
      "--meta-content-color": colors.mdChar ?? darkModeColors["--meta-content-color"],
      "--strong-color": colors.strong ?? darkModeColors["--strong-color"],
      "--emphasis-color": colors.emphasis ?? darkModeColors["--emphasis-color"],
      "--blur-text-color": darkModeColors["--blur-text-color"],
      "--bg-tertiary": darkModeColors["--bg-tertiary"],
      "--text-tertiary": darkModeColors["--text-tertiary"],
      "--accent-bg": darkModeColors["--accent-bg"],
      "--source-mode-bg": darkModeColors["--source-mode-bg"],
      "--error-color": darkModeColors["--error-color"],
      "--error-bg": darkModeColors["--error-bg"],
    });
    root.classList.add("dark-theme", "dark");
  } else {
    applyVars(root, {
      ...lightModeColors,
      // Use theme's border color for bg-tertiary to harmonize with colored themes
      "--bg-tertiary": colors.border,
    });
    root.classList.remove("dark-theme", "dark");
  }
}

/** Apply typography settings (fonts, sizes, spacing) */
function applyTypography(
  root: HTMLElement,
  latinFont: string,
  cjkFont: string,
  monoFont: string,
  fontSize: number,
  lineHeight: number,
  paragraphSpacing: number,
  editorWidth: number
) {
  const latinStack =
    fontStacks.latin[latinFont as keyof typeof fontStacks.latin] ||
    fontStacks.latin.system;
  const cjkStack =
    fontStacks.cjk[cjkFont as keyof typeof fontStacks.cjk] ||
    fontStacks.cjk.system;
  const monoStack =
    fontStacks.mono[monoFont as keyof typeof fontStacks.mono] ||
    fontStacks.mono.system;

  applyVars(root, {
    "--font-sans": `${latinStack}, ${cjkStack}`,
    "--font-mono": monoStack,
    "--editor-font-size": `${fontSize}px`,
    "--editor-line-height": String(lineHeight),
    "--editor-paragraph-spacing": `${paragraphSpacing}em`,
    "--editor-width": editorWidth > 0 ? `${editorWidth}em` : "none",
  });
}

export function useTheme() {
  const appearance = useSettingsStore((state) => state.appearance);

  useEffect(() => {
    const root = document.documentElement;
    // Guard against invalid theme key (e.g., from corrupted localStorage)
    const themeColors = themes[appearance.theme] ?? themes.paper;
    const isDark = themeColors.isDark ?? false;

    applyCoreColors(root, themeColors);
    applyModeColors(root, themeColors, isDark);
    applyTypography(
      root,
      appearance.latinFont,
      appearance.cjkFont,
      appearance.monoFont,
      appearance.fontSize,
      appearance.lineHeight,
      appearance.paragraphSpacing,
      appearance.editorWidth ?? 50
    );
  }, [appearance]);
}
