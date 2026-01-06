type WysiwygFlusher = () => void;

let activeWysiwygFlusher: WysiwygFlusher | null = null;

export function registerActiveWysiwygFlusher(flusher: WysiwygFlusher | null) {
  activeWysiwygFlusher = flusher;
}

export function flushActiveWysiwygNow() {
  activeWysiwygFlusher?.();
}

