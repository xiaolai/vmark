/**
 * Tests for Outline View utility functions
 */

import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  buildHeadingTree,
  filterHeadingTree,
  getHeadingLinesKey,
  type HeadingItem,
  type HeadingNode,
} from "../outlineUtils";

describe("extractHeadings", () => {
  describe("basic extraction", () => {
    it("extracts ATX headings (# style)", () => {
      const content = `# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(6);
      expect(headings[0]).toEqual({ level: 1, text: "Heading 1", line: 0 });
      expect(headings[1]).toEqual({ level: 2, text: "Heading 2", line: 1 });
      expect(headings[5]).toEqual({ level: 6, text: "Heading 6", line: 5 });
    });

    it("ignores lines that are not headings", () => {
      const content = `# Real Heading
Some paragraph text
##Not a heading (no space)
 # Not a heading (leading space)`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(1);
      expect(headings[0].text).toBe("Real Heading");
    });

    it("trims heading text", () => {
      const content = `# Heading with trailing spaces
##   Heading with leading spaces`;

      const headings = extractHeadings(content);

      expect(headings[0].text).toBe("Heading with trailing spaces");
      expect(headings[1].text).toBe("Heading with leading spaces");
    });

    it("returns empty array for content without headings", () => {
      const content = `Just some text
No headings here`;

      expect(extractHeadings(content)).toEqual([]);
    });

    it("returns empty array for empty content", () => {
      expect(extractHeadings("")).toEqual([]);
    });

    it("handles ATX closing hashes", () => {
      const content = `# Heading with closing hashes ###
## Another one ##`;

      const headings = extractHeadings(content);

      expect(headings[0].text).toBe("Heading with closing hashes");
      expect(headings[1].text).toBe("Another one");
    });
  });

  describe("code block handling", () => {
    it("ignores headings inside fenced code blocks (backticks)", () => {
      const content = `# Real Heading

\`\`\`python
# This is a comment, not a heading
def foo():
    pass
\`\`\`

## Another Real Heading`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(2);
      expect(headings[0].text).toBe("Real Heading");
      expect(headings[1].text).toBe("Another Real Heading");
    });

    it("ignores headings inside fenced code blocks (tildes)", () => {
      const content = `# Before

~~~
# Not a heading
~~~

## After`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(2);
      expect(headings[0].text).toBe("Before");
      expect(headings[1].text).toBe("After");
    });

    it("handles code blocks with language specifier", () => {
      const content = `# Intro

\`\`\`markdown
# Markdown example
## Another example
\`\`\`

# Conclusion`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(2);
      expect(headings[0].text).toBe("Intro");
      expect(headings[1].text).toBe("Conclusion");
    });

    it("handles nested backticks in code blocks", () => {
      const content = `# Before

\`\`\`\`
\`\`\`
# Not a heading
\`\`\`
\`\`\`\`

# After`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(2);
      expect(headings[0].text).toBe("Before");
      expect(headings[1].text).toBe("After");
    });

    it("handles multiple code blocks", () => {
      const content = `# One

\`\`\`
# skip
\`\`\`

## Two

\`\`\`
# skip again
\`\`\`

### Three`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(3);
      expect(headings.map((h) => h.text)).toEqual(["One", "Two", "Three"]);
    });

    it("ignores inline code (not blocks)", () => {
      const content = `# Heading with \`code\` inline
## Use \`# hash\` in code`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(2);
    });

    it("handles unclosed code block (treat rest as code)", () => {
      const content = `# Before

\`\`\`
# Inside unclosed block
## Also inside`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(1);
      expect(headings[0].text).toBe("Before");
    });
  });

  describe("edge cases", () => {
    it("handles heading with only hash and space (no text)", () => {
      const content = `#
## Real heading`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(1);
      expect(headings[0].text).toBe("Real heading");
    });

    it("handles 7+ hashes (not a heading)", () => {
      const content = `####### Not a heading
###### Valid heading`;

      const headings = extractHeadings(content);

      expect(headings).toHaveLength(1);
      expect(headings[0].text).toBe("Valid heading");
    });

    it("preserves correct line numbers with code blocks", () => {
      const content = `# Line 0

\`\`\`
# Line 3
\`\`\`

## Line 6`;

      const headings = extractHeadings(content);

      expect(headings[0].line).toBe(0);
      expect(headings[1].line).toBe(6);
    });
  });
});

describe("buildHeadingTree", () => {
  it("builds flat tree for same-level headings", () => {
    const headings: HeadingItem[] = [
      { level: 2, text: "A", line: 0 },
      { level: 2, text: "B", line: 1 },
      { level: 2, text: "C", line: 2 },
    ];

    const tree = buildHeadingTree(headings);

    expect(tree).toHaveLength(3);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[1].children).toHaveLength(0);
    expect(tree[2].children).toHaveLength(0);
  });

  it("nests children under parent", () => {
    const headings: HeadingItem[] = [
      { level: 1, text: "Parent", line: 0 },
      { level: 2, text: "Child 1", line: 1 },
      { level: 2, text: "Child 2", line: 2 },
    ];

    const tree = buildHeadingTree(headings);

    expect(tree).toHaveLength(1);
    expect(tree[0].text).toBe("Parent");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].text).toBe("Child 1");
    expect(tree[0].children[1].text).toBe("Child 2");
  });

  it("handles deep nesting", () => {
    const headings: HeadingItem[] = [
      { level: 1, text: "H1", line: 0 },
      { level: 2, text: "H2", line: 1 },
      { level: 3, text: "H3", line: 2 },
      { level: 4, text: "H4", line: 3 },
    ];

    const tree = buildHeadingTree(headings);

    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].children[0].text).toBe("H4");
  });

  it("handles skipped levels (H1 -> H3)", () => {
    const headings: HeadingItem[] = [
      { level: 1, text: "H1", line: 0 },
      { level: 3, text: "H3", line: 1 },
    ];

    const tree = buildHeadingTree(headings);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].text).toBe("H3");
  });

  it("handles ascending then descending levels", () => {
    const headings: HeadingItem[] = [
      { level: 1, text: "H1", line: 0 },
      { level: 2, text: "H2a", line: 1 },
      { level: 3, text: "H3", line: 2 },
      { level: 2, text: "H2b", line: 3 },
    ];

    const tree = buildHeadingTree(headings);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].text).toBe("H2a");
    expect(tree[0].children[0].children[0].text).toBe("H3");
    expect(tree[0].children[1].text).toBe("H2b");
  });

  it("handles document starting with H2", () => {
    const headings: HeadingItem[] = [
      { level: 2, text: "H2", line: 0 },
      { level: 1, text: "H1", line: 1 },
    ];

    const tree = buildHeadingTree(headings);

    expect(tree).toHaveLength(2);
    expect(tree[0].text).toBe("H2");
    expect(tree[1].text).toBe("H1");
  });

  it("preserves original index", () => {
    const headings: HeadingItem[] = [
      { level: 1, text: "A", line: 0 },
      { level: 2, text: "B", line: 1 },
      { level: 2, text: "C", line: 2 },
    ];

    const tree = buildHeadingTree(headings);

    expect(tree[0].index).toBe(0);
    expect(tree[0].children[0].index).toBe(1);
    expect(tree[0].children[1].index).toBe(2);
  });

  it("returns empty array for empty input", () => {
    expect(buildHeadingTree([])).toEqual([]);
  });
});

describe("getHeadingLinesKey", () => {
  it("extracts heading lines with line numbers", () => {
    const content = `# Heading 1
Some text
## Heading 2`;

    const key = getHeadingLinesKey(content);

    expect(key).toBe("0:# Heading 1\n2:## Heading 2");
  });

  it("ignores headings in code blocks", () => {
    const content = `# Real

\`\`\`
# Fake
\`\`\`

## Also Real`;

    const key = getHeadingLinesKey(content);

    expect(key).toBe("0:# Real\n6:## Also Real");
  });

  it("returns empty string for no headings", () => {
    expect(getHeadingLinesKey("just text")).toBe("");
  });

  it("returns empty string for empty content", () => {
    expect(getHeadingLinesKey("")).toBe("");
  });
});

describe("large document handling (issue #523)", () => {
  it("extractHeadings handles a 500KB document without truncation", () => {
    // Build a ~500K character document with headings scattered throughout
    const sectionBody = "Word ".repeat(400); // ~2000 chars per section
    const sections: string[] = [];
    for (let i = 0; i < 50; i++) {
      sections.push(`## Section ${i + 1}\n\n${sectionBody}`);
    }
    const bigDoc = `# Title\n\n${sections.join("\n\n")}`;

    expect(bigDoc.length).toBeGreaterThan(100000); // exceeds old threshold
    expect(bigDoc.length).toBeLessThan(500000); // within new threshold

    const headings = extractHeadings(bigDoc);

    expect(headings).toHaveLength(51); // 1 H1 title + 50 H2 sections
    expect(headings[0]).toMatchObject({ level: 1, text: "Title" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Section 1" });
    expect(headings[50]).toMatchObject({ level: 2, text: "Section 50" });
  });
});

describe("filterHeadingTree", () => {
  // Build a small fixture once so each test reads naturally.
  // Tree shape:
  //   Introduction (H1, idx 0)
  //     Background (H2, idx 1)
  //     Goals (H2, idx 2)
  //       Performance (H3, idx 3)
  //   Implementation (H1, idx 4)
  //     Architecture (H2, idx 5)
  //     Testing (H2, idx 6)
  function fixture(): HeadingNode[] {
    return buildHeadingTree([
      { level: 1, text: "Introduction", line: 0 },
      { level: 2, text: "Background", line: 1 },
      { level: 2, text: "Goals", line: 2 },
      { level: 3, text: "Performance", line: 3 },
      { level: 1, text: "Implementation", line: 4 },
      { level: 2, text: "Architecture", line: 5 },
      { level: 2, text: "Testing", line: 6 },
    ]);
  }

  it("returns the original tree when query is empty", () => {
    const tree = fixture();
    expect(filterHeadingTree(tree, "")).toBe(tree);
  });

  it("returns the original tree when query is whitespace only", () => {
    const tree = fixture();
    expect(filterHeadingTree(tree, "   \t  ")).toBe(tree);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterHeadingTree(fixture(), "nonexistent")).toEqual([]);
  });

  it("matches a leaf and keeps its ancestors as a path", () => {
    const result = filterHeadingTree(fixture(), "performance");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Introduction");
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].text).toBe("Goals");
    expect(result[0].children[0].children).toHaveLength(1);
    expect(result[0].children[0].children[0].text).toBe("Performance");
  });

  it("when a parent matches, keeps all of its descendants", () => {
    const result = filterHeadingTree(fixture(), "introduction");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Introduction");
    // All descendants kept verbatim, even though their text doesn't contain the query.
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children.map((n: HeadingNode) => n.text)).toEqual(["Background", "Goals"]);
    expect(result[0].children[1].children[0].text).toBe("Performance");
  });

  it("is case-insensitive", () => {
    const lower = filterHeadingTree(fixture(), "testing");
    const upper = filterHeadingTree(fixture(), "TESTING");
    const mixed = filterHeadingTree(fixture(), "TeStInG");
    expect(lower).toEqual(upper);
    expect(lower).toEqual(mixed);
    expect(lower[0].text).toBe("Implementation");
    expect(lower[0].children[0].text).toBe("Testing");
  });

  it("matches substrings, not just whole words", () => {
    const result = filterHeadingTree(fixture(), "round"); // matches "Background"
    expect(result).toHaveLength(1);
    expect(result[0].children[0].text).toBe("Background");
  });

  it("trims surrounding whitespace from the query", () => {
    const result = filterHeadingTree(fixture(), "   testing   ");
    expect(result).toHaveLength(1);
    expect(result[0].children[0].text).toBe("Testing");
  });

  it("preserves index, line, and level on filtered nodes", () => {
    const result = filterHeadingTree(fixture(), "performance");
    const intro = result[0];
    const goals = intro.children[0];
    const perf = goals.children[0];
    expect(intro).toMatchObject({ index: 0, line: 0, level: 1 });
    expect(goals).toMatchObject({ index: 2, line: 2, level: 2 });
    expect(perf).toMatchObject({ index: 3, line: 3, level: 3 });
  });

  it("returns a new tree (does not mutate the input)", () => {
    const tree = fixture();
    const before = JSON.stringify(tree);
    filterHeadingTree(tree, "testing");
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("matches multiple sibling subtrees in one pass", () => {
    // Both "Architecture" (under Implementation) and "Background" (under Introduction)
    // contain "ack"... actually "Background" contains "ack". Use a query that hits both
    // top-level branches: "i" appears in both — pick something cleaner.
    const result = filterHeadingTree(fixture(), "ground"); // only Background
    expect(result).toHaveLength(1);
    const result2 = filterHeadingTree(fixture(), "i"); // matches everything containing 'i'
    // 'i' is in Introduction, Implementation, Architecture, Testing
    expect(result2.map((n: HeadingNode) => n.text)).toEqual(["Introduction", "Implementation"]);
  });
});

describe("integration: collapsed state with level:text key", () => {
  // This documents the expected behavior for duplicate heading texts
  it("same text at different levels should be distinguishable", () => {
    const headings: HeadingItem[] = [
      { level: 1, text: "Introduction", line: 0 },
      { level: 2, text: "Introduction", line: 1 }, // Same text, different level
    ];

    // Using level:text as key means these are different
    const key1 = `${headings[0].level}:${headings[0].text}`;
    const key2 = `${headings[1].level}:${headings[1].text}`;

    expect(key1).toBe("1:Introduction");
    expect(key2).toBe("2:Introduction");
    expect(key1).not.toBe(key2);
  });

  it("same text at same level will share collapse state (documented limitation)", () => {
    const headings: HeadingItem[] = [
      { level: 2, text: "Summary", line: 0 },
      { level: 2, text: "Summary", line: 10 }, // Same text AND level
    ];

    // These will have the same key - this is a documented limitation
    const key1 = `${headings[0].level}:${headings[0].text}`;
    const key2 = `${headings[1].level}:${headings[1].text}`;

    expect(key1).toBe(key2);
  });
});
