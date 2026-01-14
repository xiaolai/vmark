/**
 * Print Preview Page
 *
 * Renders markdown content for printing to PDF.
 * Auto-triggers print dialog after content is rendered.
 */

import { useEffect, useState } from "react";
import { markdownToHtml } from "@/utils/exportUtils";

// GitHub-style print CSS
const printStyles = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #1f2328;
  background-color: #ffffff;
  max-width: 100%;
  margin: 0;
  padding: 24px;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

h1 { font-size: 1.75em; border-bottom: 1px solid #d1d5da; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d1d5da; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #6e7781; }

p { margin-top: 0; margin-bottom: 16px; }

a { color: #0969da; text-decoration: none; }

code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 85%;
  background-color: #f6f8fa;
  padding: 0.2em 0.4em;
  border-radius: 4px;
}

pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 85%;
  background-color: #f6f8fa;
  padding: 16px;
  overflow: auto;
  border-radius: 6px;
  white-space: pre-wrap;
  word-wrap: break-word;
}

pre code {
  background-color: transparent;
  padding: 0;
}

blockquote {
  margin: 0 0 16px 0;
  padding: 0 1em;
  color: #656d76;
  border-left: 0.25em solid #d1d5da;
}

ul, ol {
  margin-top: 0;
  margin-bottom: 16px;
  padding-left: 2em;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 16px;
}

th, td {
  padding: 6px 13px;
  border: 1px solid #d1d5da;
}

th {
  font-weight: 600;
  background-color: #f6f8fa;
}

hr {
  height: 0.25em;
  margin: 24px 0;
  background-color: #d1d5da;
  border: 0;
}

img {
  max-width: 100%;
  height: auto;
}

@media print {
  body { padding: 0; }
  @page { margin: 1.5cm; }
}
`;

export function PrintPreviewPage() {
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read content from localStorage (set by main window before opening this window)
    const markdown = localStorage.getItem("vmark-print-content");
    if (markdown) {
      const html = markdownToHtml(markdown);
      setHtmlContent(html);
      setReady(true);

      // Clean up
      localStorage.removeItem("vmark-print-content");

      // Auto-trigger print after content is rendered
      setTimeout(() => {
        window.print();
      }, 300);
    } else {
      // Set timeout to show error if content never arrives
      const timeout = setTimeout(() => {
        setError("No content available for preview. Please try again.");
      }, 2000);

      return () => clearTimeout(timeout);
    }
  }, []);

  return (
    <>
      <style>{printStyles}</style>
      <div
        className="print-preview-content"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
      {!ready && !error && (
        <div style={{ padding: 24, color: "#666" }}>
          Loading preview...
        </div>
      )}
      {error && (
        <div style={{ padding: 24, color: "#cf222e" }}>
          {error}
        </div>
      )}
    </>
  );
}
