/**
 * Outline View Utility Functions
 *
 * Extracts headings from markdown content and builds a tree structure.
 */

export interface HeadingItem {
  level: number;
  text: string;
  line: number; // 0-based line number in content
}

export interface HeadingNode extends HeadingItem {
  children: HeadingNode[];
  index: number; // Original index in flat list
}

/**
 * Check if a line is a fenced code block delimiter.
 * Returns the fence string if it opens/closes a block, null otherwise.
 */
export function parseFenceDelimiter(line: string, currentFence: string | null): string | null {
  // Match opening fence: 3+ backticks or tildes at start of line
  const fenceMatch = line.match(/^(`{3,}|~{3,})/);

  if (!fenceMatch) return null;

  const fence = fenceMatch[1];
  const fenceChar = fence[0];
  const fenceLen = fence.length;

  if (currentFence === null) {
    // Opening a new fence
    return fence;
  }

  // Check if this closes the current fence:
  // - Must use same character
  // - Must be at least as long as opening fence
  if (fenceChar === currentFence[0] && fenceLen >= currentFence.length) {
    // Check that closing fence has no content after it (only whitespace allowed)
    const afterFence = line.slice(fenceLen);
    if (/^\s*$/.test(afterFence)) {
      return fence; // Closes the block
    }
  }

  return null;
}

/**
 * Extract headings from markdown content.
 * Ignores headings inside fenced code blocks.
 */
export function extractHeadings(content: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = content.split("\n");

  let currentFence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for fence delimiter
    const fence = parseFenceDelimiter(line, currentFence);
    if (fence !== null) {
      if (currentFence === null) {
        // Entering code block
        currentFence = fence;
      } else {
        // Exiting code block
        currentFence = null;
      }
      continue;
    }

    // Skip if inside code block
    if (currentFence !== null) continue;

    // Match ATX heading: 1-6 hashes, space, then content
    // Also handle optional closing hashes: # Heading ###
    const match = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i,
      });
    }
  }

  return headings;
}

/**
 * Build a tree structure from a flat list of headings.
 * Lower level numbers are parents of higher level numbers.
 */
export function buildHeadingTree(headings: HeadingItem[]): HeadingNode[] {
  const root: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  headings.forEach((heading, index) => {
    const node: HeadingNode = { ...heading, children: [], index };

    // Pop stack until we find a parent with smaller level
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  });

  return root;
}

/**
 * Extract only heading lines from content for comparison.
 * Used to avoid re-extracting headings when non-heading content changes.
 * Must use same code block detection as extractHeadings for consistency.
 */
export function getHeadingLinesKey(content: string): string {
  const lines = content.split("\n");
  const headingLines: string[] = [];

  let currentFence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for fence delimiter
    const fence = parseFenceDelimiter(line, currentFence);
    if (fence !== null) {
      if (currentFence === null) {
        currentFence = fence;
      } else {
        currentFence = null;
      }
      continue;
    }

    // Skip if inside code block
    if (currentFence !== null) continue;

    // Match heading pattern (same as extractHeadings)
    if (/^#{1,6}\s+.+/.test(line)) {
      headingLines.push(`${i}:${line}`);
    }
  }

  return headingLines.join("\n");
}

/**
 * Count total nodes in a heading tree (including all nested children).
 */
export function countTreeNodes(tree: HeadingNode[]): number {
  let count = 0;
  for (const node of tree) {
    count += 1 + countTreeNodes(node.children);
  }
  return count;
}

/**
 * Build a limited tree that includes only the first N nodes in document order.
 * Preserves tree structure but truncates at the limit.
 */
export function buildLimitedTree(tree: HeadingNode[], limit: number): HeadingNode[] {
  let remaining = limit;

  function cloneWithLimit(nodes: HeadingNode[]): HeadingNode[] {
    const result: HeadingNode[] = [];

    for (const node of nodes) {
      if (remaining <= 0) break;
      remaining--;

      const clonedChildren = cloneWithLimit(node.children);
      result.push({ ...node, children: clonedChildren });
    }

    return result;
  }

  return cloneWithLimit(tree);
}
