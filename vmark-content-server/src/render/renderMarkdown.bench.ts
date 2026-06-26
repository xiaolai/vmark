// M-2 / WI-8.4 — perf bench: render a representative note. Run: `pnpm bench`.
import { bench, describe } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

const DOC =
  "# Heading\n\n" +
  "Paragraph with **bold**, *em*, `code`, [[wiki-link]] and a [link](https://e.com).\n\n".repeat(
    40
  ) +
  "> [!NOTE]\n> alert body\n\n" +
  "| a | b |\n|---|---|\n| 1 | 2 |\n\n" +
  "Inline $x^2$ and block:\n\n$$\\frac{1}{2}$$\n";

describe("renderMarkdown — representative note", () => {
  bench("render headless HTML (remark→rehype→KaTeX→sanitize)", async () => {
    await renderMarkdown(DOC);
  }, { time: 500 });
});
