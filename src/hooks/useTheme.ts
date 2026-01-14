import { useEffect } from "react";
import { useSettingsStore, themes } from "@/stores/settingsStore";

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

export function useTheme() {
  const appearance = useSettingsStore((state) => state.appearance);

  useEffect(() => {
    const root = document.documentElement;
    const themeColors = themes[appearance.theme];
    const isDark = themeColors.isDark ?? false;

    // Apply core theme colors
    root.style.setProperty("--bg-color", themeColors.background);
    root.style.setProperty("--text-color", themeColors.foreground);
    root.style.setProperty("--primary-color", themeColors.link);
    root.style.setProperty("--bg-secondary", themeColors.secondary);
    root.style.setProperty("--border-color", themeColors.border);

    // Accent colors (linked to primary)
    root.style.setProperty("--accent-primary", themeColors.link);
    root.style.setProperty("--accent-text", themeColors.link);

    // UI chrome colors (sidebar, etc.)
    root.style.setProperty("--sidebar-bg", themeColors.secondary);
    root.style.setProperty("--code-bg-color", themeColors.secondary);
    root.style.setProperty("--code-border-color", themeColors.border);
    root.style.setProperty("--table-border-color", themeColors.border);

    // Dark mode specific variables
    if (isDark) {
      root.style.setProperty("--text-secondary", themeColors.textSecondary ?? "#858585");
      root.style.setProperty("--code-text-color", themeColors.codeText ?? themeColors.foreground);
      root.style.setProperty("--selection-color", themeColors.selection ?? "rgba(79, 193, 255, 0.2)");
      root.style.setProperty("--md-char-color", themeColors.mdChar ?? "#6a9955");
      root.style.setProperty("--meta-content-color", themeColors.mdChar ?? "#6a9955");
      root.style.setProperty("--strong-color", themeColors.strong ?? "#569cd6");
      root.style.setProperty("--emphasis-color", themeColors.emphasis ?? "#ce9178");
      root.style.setProperty("--blur-text-color", "#6b7078");
      root.style.setProperty("--bg-tertiary", "#32363d");
      root.style.setProperty("--text-tertiary", "#6b7078");
      root.style.setProperty("--accent-bg", "rgba(90, 168, 255, 0.12)");
      root.style.setProperty("--source-mode-bg", "rgba(255, 255, 255, 0.02)");
      // Error colors for dark mode
      root.style.setProperty("--error-color", "#f85149");
      root.style.setProperty("--error-bg", "rgba(248, 81, 73, 0.15)");
      root.classList.add("dark-theme", "dark");
    } else {
      // Light mode defaults
      root.style.setProperty("--text-secondary", "#666666");
      root.style.setProperty("--code-text-color", "#1a1a1a");
      root.style.setProperty("--selection-color", "rgba(0, 102, 204, 0.2)");
      root.style.setProperty("--md-char-color", "#777777");
      root.style.setProperty("--meta-content-color", "#777777");
      root.style.setProperty("--strong-color", "rgb(63, 86, 99)");
      root.style.setProperty("--emphasis-color", "rgb(91, 4, 17)");
      root.style.setProperty("--blur-text-color", "#c8c8c8");
      // Use theme's border color for bg-tertiary to harmonize with colored themes
      root.style.setProperty("--bg-tertiary", themeColors.border);
      root.style.setProperty("--text-tertiary", "#999999");
      root.style.setProperty("--accent-bg", "rgba(0, 102, 204, 0.1)");
      root.style.setProperty("--source-mode-bg", "rgba(0, 0, 0, 0.02)");
      // Error colors for light mode
      root.style.setProperty("--error-color", "#cf222e");
      root.style.setProperty("--error-bg", "#ffebe9");
      root.classList.remove("dark-theme", "dark");
    }

    // Apply typography
    const latinStack =
      fontStacks.latin[appearance.latinFont as keyof typeof fontStacks.latin] ||
      fontStacks.latin.system;
    const cjkStack =
      fontStacks.cjk[appearance.cjkFont as keyof typeof fontStacks.cjk] ||
      fontStacks.cjk.system;
    const monoStack =
      fontStacks.mono[appearance.monoFont as keyof typeof fontStacks.mono] ||
      fontStacks.mono.system;

    root.style.setProperty("--font-sans", `${latinStack}, ${cjkStack}`);
    root.style.setProperty("--font-mono", monoStack);
    root.style.setProperty("--editor-font-size", `${appearance.fontSize}px`);
    root.style.setProperty(
      "--editor-line-height",
      String(appearance.lineHeight)
    );
    root.style.setProperty(
      "--editor-paragraph-spacing",
      `${appearance.paragraphSpacing}em`
    );

    // Editor width (0 = unlimited)
    root.style.setProperty(
      "--editor-width",
      appearance.editorWidth > 0 ? `${appearance.editorWidth}em` : "none"
    );

  }, [appearance]);
}
