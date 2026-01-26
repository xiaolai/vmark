/**
 * MCP Bridge - Cursor Handler Test Utilities
 *
 * Shared mock factories for cursor handler tests.
 */

import { vi } from "vitest";

/**
 * Create a mock ProseMirror node with textContent and type info.
 */
export function createMockNode(
  textContent: string,
  typeName = "paragraph",
  attrs: Record<string, unknown> = {}
) {
  return {
    textContent,
    type: { name: typeName },
    attrs,
  };
}

/**
 * Create a mock parent node with children.
 */
export function createMockParentNode(children: ReturnType<typeof createMockNode>[]) {
  return {
    childCount: children.length,
    child: (index: number) => children[index],
    type: { name: "doc" },
  };
}

/**
 * Create a mock $pos (resolved position) object.
 */
export function createMock$Pos(options: {
  parent: ReturnType<typeof createMockNode>;
  depth: number;
  blockIndex: number;
  parentNode: ReturnType<typeof createMockParentNode>;
  ancestors?: Array<{ name: string; attrs?: Record<string, unknown> }>;
}) {
  const ancestors = options.ancestors ?? [];
  return {
    parent: options.parent,
    depth: options.depth,
    index: (depth: number) => (depth === 1 ? options.blockIndex : 0),
    node: (depth: number) => {
      if (depth === 0) return options.parentNode;
      // Return ancestors in reverse order (depth 1 is first ancestor above parent)
      const ancestorIndex = options.depth - 1 - depth;
      if (ancestorIndex >= 0 && ancestorIndex < ancestors.length) {
        return { type: { name: ancestors[ancestorIndex].name }, attrs: ancestors[ancestorIndex].attrs ?? {} };
      }
      return options.parent;
    },
    before: (depth: number) => depth * 10, // Simple mock: position = depth * 10
  };
}

/**
 * Create a mock editor with document state.
 */
export function createMockEditor(options: {
  from: number;
  $pos: ReturnType<typeof createMock$Pos>;
  doc: ReturnType<typeof createMockParentNode>;
}) {
  return {
    state: {
      selection: { from: options.from },
      doc: {
        ...options.doc,
        resolve: () => options.$pos,
      },
    },
    commands: {
      setTextSelection: vi.fn(),
    },
  };
}
