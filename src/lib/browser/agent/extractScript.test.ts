// WI-NB4.1 — the extract capture script: whole-document HTML with an honest
// truncation flag; never throws, even on a documentless frame.
import { describe, it, expect } from "vitest";
import { buildExtractHtmlScript, EXTRACT_HTML_CAP } from "./extractScript";

function exec(doc: Document | null): { html: string; truncated: boolean } {
  const fn = new Function("document", buildExtractHtmlScript());
  return JSON.parse(fn(doc) as string) as { html: string; truncated: boolean };
}

describe("buildExtractHtmlScript", () => {
  it("returns the full document HTML untruncated", () => {
    const doc = new DOMParser().parseFromString("<body><main><h1>Hi</h1></main></body>", "text/html");
    const res = exec(doc);
    expect(res.truncated).toBe(false);
    expect(res.html).toContain("<h1>Hi</h1>");
    expect(res.html.startsWith("<html")).toBe(true);
  });

  it("caps oversized documents and says so", () => {
    const doc = new DOMParser().parseFromString(`<body><p>${"x".repeat(EXTRACT_HTML_CAP + 100)}</p></body>`, "text/html");
    const res = exec(doc);
    expect(res.truncated).toBe(true);
    expect(res.html.length).toBe(EXTRACT_HTML_CAP);
  });

  it("never throws without a document", () => {
    const res = exec(null);
    expect(res).toEqual({ html: "", truncated: false });
  });
});
