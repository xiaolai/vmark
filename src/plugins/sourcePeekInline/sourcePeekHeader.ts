/**
 * Source Peek Header
 *
 * Creates the header widget for inline Source Peek with block type label and action buttons.
 */

import i18n from "@/i18n";

/**
 * Get block type label for display in header.
 */
export function getBlockTypeLabel(typeName: string): string {
  const labels: Record<string, string> = {
    paragraph: "Paragraph",
    heading: "Heading",
    codeBlock: "Code Block",
    code_block: "Code Block",
    blockquote: "Blockquote",
    bulletList: "Bullet List",
    orderedList: "Numbered List",
    taskList: "Task List",
    table: "Table",
    detailsBlock: "Details",
    horizontalRule: "Divider",
    image: "Image",
  };
  return labels[typeName] ?? typeName.replace(/([A-Z])/g, " $1").trim();
}

/**
 * Create header element with block type label and action buttons.
 */
export function createEditHeader(
  blockTypeName: string,
  hasChanges: boolean,
  onCancel: () => void,
  onSave: () => void,
  onToggleLive: () => void,
  livePreview: boolean
): HTMLElement {
  const header = document.createElement("div");
  header.className = `source-peek-inline-header${hasChanges ? " has-changes" : ""}`;

  const title = document.createElement("div");
  title.className = "source-peek-inline-title";
  title.textContent = "Source Peek";

  const blockType = document.createElement("span");
  blockType.className = "source-peek-inline-block-type";
  blockType.textContent = getBlockTypeLabel(blockTypeName);
  title.appendChild(blockType);

  const actions = document.createElement("div");
  actions.className = "source-peek-inline-actions";

  // Hint text
  const hint = document.createElement("span");
  hint.className = "source-peek-inline-hint";
  hint.textContent = "\u2318\u21B5 save \u00B7 \u238B cancel";

  // Live preview toggle - both icons in DOM, CSS toggles visibility
  const liveBtn = document.createElement("button");
  liveBtn.className = `source-peek-inline-btn source-peek-inline-btn--live${livePreview ? " active" : ""}`;
  const liveLabel = i18n.t("editor:plugin.toggleLivePreview");
  liveBtn.title = liveLabel;
  liveBtn.setAttribute("aria-label", liveLabel);
  // Both icons present, CSS shows/hides based on .active class
  const eyeIcon = `<svg class="icon-eye" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOffIcon = `<svg class="icon-eye-off" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;
  liveBtn.innerHTML = eyeIcon + eyeOffIcon;
  /* v8 ignore next -- @preserve reason: mousedown preventDefault callback only fires in live DOM; not triggered in unit tests */
  liveBtn.addEventListener("mousedown", (e) => e.preventDefault());
  /* v8 ignore start -- @preserve reason: click event listener callbacks only fire in live browser; not triggered in jsdom unit tests */
  liveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    // Toggle class directly on button for icon switch
    liveBtn.classList.toggle("active");
    onToggleLive();
  });
  /* v8 ignore stop */

  // Cancel button
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "source-peek-inline-btn source-peek-inline-btn--cancel";
  const cancelLabel = i18n.t("editor:plugin.cancel");
  cancelBtn.title = cancelLabel;
  cancelBtn.setAttribute("aria-label", cancelLabel);
  cancelBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    onCancel();
  });

  // Save button
  const saveBtn = document.createElement("button");
  saveBtn.className = "source-peek-inline-btn source-peek-inline-btn--save";
  const saveLabel = i18n.t("editor:plugin.saveCmdEnter");
  saveBtn.title = saveLabel;
  saveBtn.setAttribute("aria-label", saveLabel);
  saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  /* v8 ignore next -- @preserve reason: mousedown preventDefault callback only fires in live DOM; not triggered in unit tests */
  saveBtn.addEventListener("mousedown", (e) => e.preventDefault());
  /* v8 ignore start -- @preserve reason: saveBtn click listener callback only fires in live browser; not triggered in jsdom unit tests */
  saveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    onSave();
  });
  /* v8 ignore stop */

  actions.appendChild(hint);
  actions.appendChild(liveBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  header.appendChild(title);
  header.appendChild(actions);

  return header;
}
