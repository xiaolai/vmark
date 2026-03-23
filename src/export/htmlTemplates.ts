/**
 * HTML Templates for Export
 *
 * Purpose: Generate the final HTML documents (index.html and standalone.html)
 * from prepared content, styles, and scripts. Contains the HTML page structure
 * and assembly logic for both external-asset and embedded variants.
 *
 * @module export/htmlTemplates
 * @coordinates-with htmlExport.ts — called during export to produce final HTML files
 */

/**
 * Escape HTML special characters.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate index.html with external CSS/JS references.
 */
export function generateIndexHtml(
  content: string,
  options: {
    title: string;
    themeCSS: string;
    fontCSS: string;
    contentCSS: string;
    isDark?: boolean;
    includeKaTeX?: boolean;
  }
): string {
  const { title, themeCSS, fontCSS, contentCSS, isDark, includeKaTeX = true } = options;

  // Inline only theme, font, and content CSS (small)
  // Reader CSS/JS are external
  const inlineStyles = [
    `/* Theme Variables */\n${themeCSS}`,
    `/* Fonts */\n${fontCSS}`,
    `/* Content Styles */\n${contentCSS}`,
  ].filter(s => s.trim()).join("\n\n");

  const themeClass = isDark ? "dark-theme" : "";

  const katexLink = includeKaTeX
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.28/dist/katex.min.css" crossorigin="anonymous">`
    : "";

  return `<!DOCTYPE html>
<html lang="en" class="${themeClass}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${katexLink}
  <link rel="stylesheet" href="assets/vmark-reader.css">
  <style>
${inlineStyles}
  </style>
</head>
<body>
  <div class="export-surface">
    <div class="export-surface-editor">
${content}
    </div>
  </div>
  <script src="assets/vmark-reader.js"></script>
</body>
</html>`;
}

/**
 * Generate standalone.html with everything embedded.
 */
export function generateStandaloneHtml(
  content: string,
  options: {
    title: string;
    themeCSS: string;
    fontCSS: string;
    contentCSS: string;
    readerCSS: string;
    readerJS: string;
    isDark?: boolean;
    includeKaTeX?: boolean;
  }
): string {
  const { title, themeCSS, fontCSS, contentCSS, readerCSS, readerJS, isDark, includeKaTeX = true } = options;

  const allStyles = [
    `/* Theme Variables */\n${themeCSS}`,
    `/* Fonts */\n${fontCSS}`,
    `/* Content Styles */\n${contentCSS}`,
    `/* VMark Reader */\n${readerCSS}`,
  ].filter(s => s.trim()).join("\n\n");

  const themeClass = isDark ? "dark-theme" : "";

  const katexLink = includeKaTeX
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.28/dist/katex.min.css" crossorigin="anonymous">`
    : "";

  return `<!DOCTYPE html>
<html lang="en" class="${themeClass}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${katexLink}
  <style>
${allStyles}
  </style>
</head>
<body>
  <div class="export-surface">
    <div class="export-surface-editor">
${content}
    </div>
  </div>
  <script>
${readerJS}
  </script>
</body>
</html>`;
}
