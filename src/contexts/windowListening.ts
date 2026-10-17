/**
 * windowListening — whether this window has announced that it is listening,
 * for the document surface to wait on.
 *
 * Purpose: the document surface mounts only after the window-ready handshake.
 *   Building a large document's WYSIWYG view is seconds of main-thread work on
 *   a slow machine; started first, it starved the menu and close listeners the
 *   handshake waits on, and the handshake gave up with the menu still
 *   mounting (#1565).
 *
 * Key decisions:
 *   - Held back only once ARMED, which a document window's handshake does.
 *     A window that never arms it, and a test that renders a surface without
 *     the provider, mounts the surface at once.
 *   - Level-triggered and one-way: once listening it stays listening, so a
 *     surface mounting later sees it immediately and a StrictMode replay
 *     cannot close it again.
 *   - An external store, not a WindowContext field: it is a fact about the
 *     window, and the many tests that stub the WindowContext module must not
 *     lose their document surface by doing so.
 *
 * @coordinates-with contexts/useWindowReady.ts — arms it, and publishes it when announcing
 * @coordinates-with components/Editor/DocumentSplit/DocumentSplitContainer.tsx — the surface that waits
 * @module contexts/windowListening
 */
import { useSyncExternalStore } from "react";

type ListeningState = "unarmed" | "armed" | "listening";

let state: ListeningState = "unarmed";
const subscribers = new Set<() => void>();

function transition(next: ListeningState): void {
  if (state === next) return;
  const wasListening = isWindowListening();
  state = next;
  if (isWindowListening() === wasListening) return;
  for (const notify of [...subscribers]) notify();
}

/** A document window has begun its handshake: hold the surface until it announces. */
export function armWindowListening(): void {
  if (state === "unarmed") transition("armed");
}

/** The window has announced itself to Rust; the surface may mount. */
export function publishWindowListening(): void {
  transition("listening");
}

/** Whether a document surface may mount in this window now. */
export function isWindowListening(): boolean {
  return state !== "armed";
}

/** Called whenever {@link isWindowListening} changes; returns the unsubscribe. */
export function subscribeWindowListening(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/** React adapter: the component re-renders when the window starts listening. */
export function useWindowListening(): boolean {
  return useSyncExternalStore(subscribeWindowListening, isWindowListening, isWindowListening);
}

/** Back to unarmed, for tests. */
export function resetWindowListeningForTest(): void {
  transition("unarmed");
}
