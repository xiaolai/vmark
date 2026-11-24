/**
 * TreeDndScope — owns the react-dnd manager (and HTML5 backend) for exactly one
 * mount of the file explorer's react-arborist Tree, and releases that backend
 * when the mount goes away.
 *
 * Left to itself, every Tree mount brings its own DndProvider, whose manager
 * lives in a window-global slot that react-dnd CLEARS when its last provider
 * unmounts — without tearing the manager's backend down. Normally the backend
 * releases itself once the Tree unregisters its last drag source / drop target,
 * but a NATIVE-item drag (a file, a link, selected text) registers a synthetic
 * source of its own that only the DOM `drop` or final `dragleave` removes. When
 * Tauri's drag-drop handler intercepts them, that pending native drag keeps the
 * old backend set up. Without this scope, the next Tree mount built a second
 * backend, and react-dnd threw "Cannot have two HTML5 backends at the same
 * time" during commit, taking down the whole view (#1714).
 *
 * Here the manager is created per mount and its backend is released in a
 * LAYOUT cleanup — which React runs, for a removed subtree, before any layout
 * effect of the subtree replacing it registers with a new backend. Releasing
 * first cancels a pending native drag and unregisters its synthetic source, so
 * a Suspense hide (the same cleanup, Tree kept) cannot carry a stale drag into
 * the reveal: the Tree's targets re-registering set the backend up afresh.
 *
 * @coordinates-with FileExplorer.tsx — keys this scope the way it keyed the Tree
 * @module components/Sidebar/FileExplorer/TreeDndScope
 */

import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  createDragDropManager,
  type Backend,
  type BackendFactory,
  type DragDropManager,
} from "dnd-core";
import { HTML5Backend, NativeTypes } from "react-dnd-html5-backend";

interface TreeDndScopeProps {
  /** Renders the Tree, handing it this mount's manager as `dndManager`. */
  children: (manager: DragDropManager) => ReactNode;
}

/** HTML5Backend's public window-level drop handlers (not on dnd-core's Backend type). */
type Html5Backend = Backend & {
  handleTopDrop: (e: DragEvent) => void;
  handleTopDropCapture: (e: DragEvent) => void;
};

const NATIVE_ITEM_TYPES: ReadonlySet<unknown> = new Set(Object.values(NativeTypes));

/** Stand-in for a `drop` the DOM will not deliver: no data, nothing to prevent. */
const NO_DROP = { dataTransfer: null, preventDefault: () => {} } as unknown as DragEvent;

/** One Tree mount's manager, plus the scope's hold on its backend. */
export interface TreeDnd {
  manager: DragDropManager;
  /** Cancel a pending native drag and release the backend (unmount, Suspense hide). */
  release: () => void;
}

/**
 * A manager whose HTML5 backend:
 * - only undoes a setup it actually did — the stock teardown clears the
 *   WINDOW-wide "a backend is set up" flag unconditionally, which would erase
 *   another backend's claim;
 * - ignores a DOM `drop` while nothing is being dragged — a backend set up
 *   mid-gesture (a remount between `dragenter` and `drop`) otherwise throws
 *   "Cannot call hover while not dragging" from its drop handler.
 */
export function createTreeDnd(): TreeDnd {
  let isSetUp = false;
  let backend: Html5Backend | null = null;

  const factory: BackendFactory = (manager, context, options) => {
    const created = HTML5Backend(manager, context, options) as Html5Backend;
    const setup = created.setup.bind(created);
    const teardown = created.teardown.bind(created);
    const handleTopDrop = created.handleTopDrop;
    created.setup = () => {
      setup();
      isSetUp = true;
    };
    created.teardown = () => {
      if (!isSetUp) return;
      isSetUp = false;
      teardown();
    };
    // Read by setup() when it installs its listeners, so replace it first.
    created.handleTopDrop = (e) => {
      if (manager.getMonitor().isDragging()) handleTopDrop(e);
    };
    backend = created;
    return created;
  };

  const manager = createDragDropManager(factory);
  return {
    manager,
    release: () => {
      if (!isSetUp) return;
      const monitor = manager.getMonitor();
      if (monitor.isDragging() && NATIVE_ITEM_TYPES.has(monitor.getItemType())) {
        const sourceId = monitor.getSourceId();
        manager.getActions().endDrag();
        if (sourceId) manager.getRegistry().removeSource(sourceId);
      }
      // Forget the elements the cancelled gesture had entered, so the next
      // `dragenter` counts as a first enter and can start a fresh drag.
      backend?.handleTopDropCapture(NO_DROP);
      backend?.teardown();
    },
  };
}

/** One drag-drop manager per Tree mount, released on unmount. */
export function TreeDndScope({ children }: TreeDndScopeProps) {
  const [dnd] = useState(createTreeDnd);
  useLayoutEffect(() => dnd.release, [dnd]);
  return <>{children(dnd.manager)}</>;
}
