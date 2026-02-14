import { describe, it, expect } from "vitest";
import { buildCodeMask } from "./markdownCodeMask";

/** Convert Uint8Array mask to a string of 0s and 1s for readable assertions. */
function maskToString(mask: Uint8Array): string {
  return Array.from(mask).map((v) => (v ? "1" : "0")).join("");
}

describe("buildCodeMask", () => {
  it("returns all zeros for plain text", () => {
    const mask = buildCodeMask("hello world");
    expect(maskToString(mask)).toBe("00000000000");
  });

  it("marks content inside backtick-fenced code block", () => {
    //                  ``` \n abc \n ```
    const md = "```\nabc\n```";
    const mask = buildCodeMask(md);
    //           ` ` ` \n a b c \n ` ` `
    //           0 0 0  0 1 1 1  0 0 0 0
    expect(maskToString(mask)).toBe("00001110000");
  });

  it("marks content inside tilde-fenced code block", () => {
    const md = "~~~\nxyz\n~~~";
    const mask = buildCodeMask(md);
    expect(maskToString(mask)).toBe("00001110000");
  });

  it("handles indented fence opener (1-3 spaces)", () => {
    const md = "  ```\nabc\n```";
    const mask = buildCodeMask(md);
    //           _  _  `  `  `  \n  a  b  c  \n  `  `  `
    //           0  0  0  0  0   0  1  1  1   0  0  0  0
    expect(maskToString(mask)).toBe("0000001110000");
  });

  it("marks content inside inline code span", () => {
    const md = "text `code` end";
    const mask = buildCodeMask(md);
    //           t e x t   `  c o d e  `     e  n  d
    //           0 0 0 0 0 0  1 1 1 1  0  0  0  0  0
    expect(maskToString(mask)).toBe("000000111100000");
  });

  it("marks content inside multi-backtick inline code", () => {
    const md = "a ``b c`` d";
    const mask = buildCodeMask(md);
    //           a   `  `  b     c  `  `     d
    //           0 0 0  0  1  1  1  0  0  0  0
    expect(maskToString(mask)).toBe("00001110000");
  });

  it("handles mixed text + fenced code block + text", () => {
    const md = "before\n```\ncode\n```\nafter";
    const mask = buildCodeMask(md);
    // b e f o r e \n ` ` ` \n c o d e \n ` ` ` \n a f t e r
    // 0 0 0 0 0 0  0 0 0 0  0 1 1 1 1  0 0 0 0  0 0 0 0 0 0
    expect(maskToString(mask)).toBe("0000000000011110000000000");
  });

  it("handles mixed text with inline code on same line", () => {
    const md = "a `b` c";
    const mask = buildCodeMask(md);
    //           a   `  b  `     c
    //           0 0 0  1  0  0  0
    expect(maskToString(mask)).toBe("0001000");
  });

  it("marks remaining content when fenced block is unclosed (EOF)", () => {
    const md = "```\nabc";
    const mask = buildCodeMask(md);
    //           ` ` ` \n a b c
    //           0 0 0  0 1 1 1
    expect(maskToString(mask)).toBe("0000111");
  });

  it("handles empty fenced block (consecutive open/close)", () => {
    const md = "```\n```";
    const mask = buildCodeMask(md);
    //           ` ` ` \n ` ` `
    //           0 0 0  0 0 0 0
    expect(maskToString(mask)).toBe("0000000");
  });

  it("handles multiple fenced blocks in one document", () => {
    const md = "```\na\n```\ntext\n```\nb\n```";
    const mask = buildCodeMask(md);
    // ` ` ` \n a \n ` ` ` \n t e x t \n ` ` ` \n b  \n ` ` `
    // 0 0 0  0 1  0 0 0 0  0 0 0 0 0  0 0 0 0  0 1   0 0 0 0
    expect(maskToString(mask)).toBe("000010000000000000010000");
  });

  it("treats 4-space indented backticks as inline code, not fence", () => {
    // 4 spaces = NOT a valid fence opener (only 0-3 spaces allowed).
    // The ``` characters act as inline code delimiters instead,
    // marking content between them — which is correct (conservative).
    const md = "    ```\nabc\n```";
    const mask = buildCodeMask(md);
    // _  _  _  _  `  `  `  \n a  b  c  \n `  `  `
    // 0  0  0  0  0  0  0   1 1  1  1   1 0  0  0
    // (inline code opens at first ```, content marked, closes at second ```)
    expect(maskToString(mask)).toBe("000000011111000");
  });

  it("requires matching fence char to close", () => {
    // backtick fence can't be closed by tildes
    const md = "```\nabc\n~~~";
    const mask = buildCodeMask(md);
    //           ` ` ` \n a b c \n ~ ~ ~
    //           0 0 0  0 1 1 1  0 1 1 1  (unclosed — ~~~ is content too)
    expect(maskToString(mask)).toBe("00001110111");
  });

  it("requires closing fence length >= opening length", () => {
    const md = "````\nabc\n```\ndef\n````";
    const mask = buildCodeMask(md);
    // ```` \n abc \n ``` \n def \n ````
    // 0000  0 111  0 111  0 111  0 0000
    // Opening: 4 backticks. ``` (3) does NOT close it. ```` (4) does.
    expect(maskToString(mask)).toBe("000001110111011100000");
  });

  it("fenced block with info string", () => {
    const md = "```js\ncode\n```";
    const mask = buildCodeMask(md);
    //           ` ` ` j s \n c o d e \n ` ` `
    //           0 0 0 0 0  0 1 1 1 1  0 0 0 0
    expect(maskToString(mask)).toBe("00000011110000");
  });

  it("inline code does not span across newlines in fenced detection", () => {
    // Inline code resets at newlines in practice, but backtick runs
    // inside fenced blocks are content — this tests the interaction.
    const md = "```\n`x`\n```";
    const mask = buildCodeMask(md);
    //           ` ` ` \n ` x ` \n ` ` `
    //           0 0 0  0 1 1 1  0 0 0 0
    // Inside fenced block, everything is content
    expect(maskToString(mask)).toBe("00001110000");
  });

  it("handles empty string", () => {
    const mask = buildCodeMask("");
    expect(mask.length).toBe(0);
    expect(maskToString(mask)).toBe("");
  });

  it("handles text with no code at all", () => {
    const md = "line one\nline two\n# heading";
    const mask = buildCodeMask(md);
    expect(maskToString(mask)).toBe("0".repeat(md.length));
  });
});
