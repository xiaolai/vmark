/**
 * DOM construction for the media preview popup.
 *
 * Builds the `<div class="image-preview-popup">` with its loading indicator,
 * `<img>`, `<video>`, `<audio>`, and error slots. Kept separate so the
 * ImagePreviewView class stays focused on lifecycle and media loading.
 *
 * @module plugins/imagePreview/containerDom
 */

import i18n from "@/i18n";

export interface PreviewDomRefs {
  container: HTMLElement;
  imageEl: HTMLImageElement;
  videoEl: HTMLVideoElement;
  audioEl: HTMLAudioElement;
  errorEl: HTMLElement;
  loadingEl: HTMLElement;
}

/** Build the preview container and return references to its child slots. */
export function buildPreviewContainer(): PreviewDomRefs {
  const container = document.createElement("div");
  container.className = "image-preview-popup";
  container.style.display = "none";

  const loadingEl = document.createElement("div");
  loadingEl.className = "image-preview-loading";
  loadingEl.textContent = i18n.t("editor:preview.loading");

  const imageEl = document.createElement("img");
  imageEl.className = "image-preview-img";
  imageEl.style.display = "none";

  const videoEl = document.createElement("video");
  videoEl.className = "image-preview-video";
  videoEl.controls = true;
  videoEl.preload = "metadata";
  videoEl.style.display = "none";

  const audioEl = document.createElement("audio");
  audioEl.className = "image-preview-audio";
  audioEl.controls = true;
  audioEl.preload = "metadata";
  audioEl.style.display = "none";

  const errorEl = document.createElement("div");
  errorEl.className = "image-preview-error";

  container.appendChild(loadingEl);
  container.appendChild(imageEl);
  container.appendChild(videoEl);
  container.appendChild(audioEl);
  container.appendChild(errorEl);

  return { container, imageEl, videoEl, audioEl, errorEl, loadingEl };
}
