/**
 * WI-3.1 — pathological input generators, ported from cmark's
 * `pathological_tests.py` classes (BSD-2): inputs that historically drive
 * markdown parsers super-linear or into deep recursion.
 *
 * Pure data, scale-parameterized: the PR tier runs `scale = 1` (reduced
 * sizes — the point there is "no hang, no stack overflow", not benchmark
 * numbers); the soak tier raises the scale toward cmark's originals.
 *
 * `serialize: true` marks classes whose PARSED document is itself deep or
 * huge, so the serializer leg gets stressed too — a parser that survives
 * deep blockquotes proves nothing about the serializer that must walk them.
 *
 * @coordinates-with runCases.ts — the child-process entry that executes these
 * @coordinates-with pathological.test.ts — the killing parent
 * @module utils/markdownPipeline/__tests__/pathological/pathologicalCases
 */

export interface PathologicalCase {
  name: string;
  markdown: string;
  /** Also run the parse→ProseMirror→markdown leg. */
  serialize: boolean;
}

export function pathologicalCases(scale = 1): PathologicalCase[] {
  const n = (base: number) => Math.max(4, Math.floor(base * scale));
  const backtickRuns = (max: number) => {
    let out = "";
    for (let i = 1; i <= max; i += 1) out += `e${"`".repeat(i)}`;
    return out;
  };
  return [
    {
      name: "nested-brackets",
      markdown: `${"[".repeat(n(2000))}a${"]".repeat(n(2000))}\n`,
      serialize: true,
    },
    {
      name: "nested-strong-emph",
      markdown: `${"*a **a ".repeat(n(300))}b${" a** a*".repeat(n(300))}\n`,
      serialize: true,
    },
    {
      name: "emph-closers-without-openers",
      markdown: `${"a_ ".repeat(n(3000))}\n`,
      serialize: true,
    },
    {
      name: "emph-openers-without-closers",
      markdown: `${"_a ".repeat(n(3000))}\n`,
      serialize: true,
    },
    {
      name: "link-closers-with-openers",
      markdown: `${"a](".repeat(n(3000))}\n`,
      serialize: true,
    },
    {
      name: "backtick-runs",
      markdown: `${backtickRuns(n(250))}\n`,
      serialize: true,
    },
    {
      name: "unclosed-inline-links",
      markdown: `${"[a](<b".repeat(n(2000))}\n`,
      serialize: true,
    },
    {
      name: "deep-blockquotes",
      markdown: `${"> ".repeat(n(500))}a\n`,
      serialize: true,
    },
    {
      name: "deep-lists",
      markdown: Array.from({ length: n(200) }, (_, i) => `${"  ".repeat(i)}- a`).join("\n") + "\n",
      serialize: true,
    },
    {
      name: "many-link-references",
      markdown:
        Array.from({ length: n(1000) }, (_, i) => `[ref${i}]: /url${i}`).join("\n") +
        `\n\n${Array.from({ length: n(1000) }, (_, i) => `[ref${i}]`).join(" ")}\n`,
      serialize: true,
    },
  ];
}
