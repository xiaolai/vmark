/**
 * useTreeWiring
 *
 * Purpose: everything FileExplorer needs to hand react-arborist a correctly
 * wired <Tree> — the two props whose IDENTITY must stay stable across renders
 * (`children` and the container callback ref), the measured height they depend
 * on, the class that names the real scroll container, and the container element
 * itself for callers that need to query into the rendered tree.
 *
 * Key decision: the two identity-stable props were inline in FileExplorer's JSX,
 * and that made
 * every click in the file explorer impossible (#1187). react-arborist uses the
 * `children` value as the row COMPONENT, so a new arrow function per render is
 * a new component type and React remounts every row; an inline callback ref is
 * likewise re-invoked with (null, element) on every render, tearing down and
 * rebuilding useObservedHeight's ResizeObserver. A row destroyed between
 * mousedown and mouseup never produces a click, so folders would not expand and
 * files would not open — while synthetic element.click() in tests kept passing.
 *
 * @coordinates-with FileExplorer.tsx — sole consumer
 * @coordinates-with useObservedHeight.ts — supplies the height, must not be re-created per render
 * @coordinates-with types.ts — FILE_TREE_SCROLLER_CLASS, the real scroller's name
 * @module components/Sidebar/FileExplorer/useTreeWiring
 */
import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import type { NodeRendererProps } from "react-arborist";
import { FileNode } from "./FileNode";
import { useObservedHeight } from "./useObservedHeight";
import { FILE_TREE_SCROLLER_CLASS, type FileNode as FileNodeType } from "./types";

export interface TreeWiring {
  /** Stable callback ref for the sizing frame (also mirrors it into `treeElRef`). */
  setTreeContainer: (el: HTMLDivElement | null) => void;
  /** Stable row renderer passed as react-arborist's children. */
  renderNode: (props: NodeRendererProps<FileNodeType>) => React.ReactElement;
  /** Measured CONTENT-box height — react-arborist needs an explicit pixel height. */
  treeHeight: number;
  /** Class for `<Tree className>`, landing on react-window's real scroll container. */
  scrollerClassName: string;
  /** The sizing frame element, for callers that need to query into the tree. */
  treeElRef: MutableRefObject<HTMLDivElement | null>;
}

/** Owns the identity-stable Tree wiring; see the module header for why it matters. */
export function useTreeWiring(currentFilePath: string | null): TreeWiring {
  const treeElRef = useRef<HTMLDivElement | null>(null);
  const [treeContainerRef, treeHeight] = useObservedHeight<HTMLDivElement>();

  const setTreeContainer = useCallback(
    (el: HTMLDivElement | null) => {
      treeContainerRef(el);
      treeElRef.current = el;
    },
    [treeContainerRef],
  );

  const renderNode = useCallback(
    (props: NodeRendererProps<FileNodeType>) => (
      <FileNode {...props} currentFilePath={currentFilePath} />
    ),
    [currentFilePath],
  );

  return {
    setTreeContainer,
    renderNode,
    treeHeight,
    scrollerClassName: FILE_TREE_SCROLLER_CLASS,
    treeElRef,
  };
}
