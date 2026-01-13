export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  );
}

export function installToolbarNavigation(opts: {
  container: HTMLElement;
  isOpen: () => boolean;
  onClose: () => void;
}) {
  const keydownHandler = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (!opts.isOpen()) return;
    if (opts.container.style.display === "none") return;

    if (e.key === "Escape") {
      e.preventDefault();
      opts.onClose();
      return;
    }

    if (e.key === "Enter") {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && opts.container.contains(activeEl) && activeEl instanceof HTMLButtonElement) {
        e.preventDefault();
        activeEl.click();
      }
      return;
    }

    if (e.key !== "Tab") return;

    const focusable = getFocusableElements(opts.container);
    if (focusable.length === 0) return;

    const activeEl = document.activeElement as HTMLElement;
    const currentIndex = focusable.indexOf(activeEl);
    if (currentIndex === -1) {
      e.preventDefault();
      const activeButton = opts.container.querySelector<HTMLElement>(".format-toolbar-btn.active");
      if (activeButton) {
        activeButton.focus();
        return;
      }
      const fallbackIndex = e.shiftKey ? focusable.length - 1 : 0;
      focusable[fallbackIndex].focus();
      return;
    }

    e.preventDefault();
    const nextIndex = e.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
    focusable[nextIndex].focus();
  };

  const outsideHandler = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!opts.container.contains(target)) {
      opts.onClose();
    }
  };

  document.addEventListener("keydown", keydownHandler, true);
  document.addEventListener("mousedown", outsideHandler);

  return () => {
    document.removeEventListener("keydown", keydownHandler, true);
    document.removeEventListener("mousedown", outsideHandler);
  };
}
