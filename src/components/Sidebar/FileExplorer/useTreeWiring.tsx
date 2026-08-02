/**
 * useTreeWiring
 *
 * Purpose: the two react-arborist props whose IDENTITY must stay stable across
 * renders, plus the measured tree height they depend on.
 *
 * Key decision: both of these were inline in FileExplorer's JSX, and that made
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
 * @module components/Sidebar/FileExplorer/useTreeWiring
 */
import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { NodeRendererProps } from "react-arborist";
import { FileNode } from "./FileNode";
import { useObservedHeight } from "./useObservedHeight";
import type { FileNode as FileNodeType } from "./types";

export interface TreeWiring {
  /** Stable callback ref for the scroll container (also mirrors it into `treeElRef`). */
  setTreeContainer: (el: HTMLDivElement | null) => void;
  /** Stable row renderer passed as react-arborist's children. */
  renderNode: (props: NodeRendererProps<FileNodeType>) => React.ReactElement;
  /** Measured container height — react-arborist needs an explicit pixel height. */
  treeHeight: number;
}

/** Owns the identity-stable Tree wiring; see the module header for why it matters. */
export function useTreeWiring(
  currentFilePath: string | null,
  treeElRef: MutableRefObject<HTMLDivElement | null>,
): TreeWiring {
  const [treeContainerRef, treeHeight] = useObservedHeight<HTMLDivElement>();

  const setTreeContainer = useCallback(
    (el: HTMLDivElement | null) => {
      treeContainerRef(el);
      treeElRef.current = el;
    },
    [treeContainerRef, treeElRef],
  );

  const renderNode = useCallback(
    (props: NodeRendererProps<FileNodeType>) => (
      <FileNode {...props} currentFilePath={currentFilePath} />
    ),
    [currentFilePath],
  );

  return { setTreeContainer, renderNode, treeHeight };
}
