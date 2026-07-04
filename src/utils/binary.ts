/**
 * Binary buffer utilities.
 *
 * Purpose: bridge `Uint8Array<ArrayBufferLike>` values (e.g. from Tauri IPC)
 * to DOM APIs (`Blob`, `crypto.subtle`) whose TypeScript 6 lib types require
 * `ArrayBuffer`-backed views and reject possibly-SharedArrayBuffer-backed ones.
 */

/**
 * Narrow a `Uint8Array` to an `ArrayBuffer`-backed view.
 *
 * Zero-copy when the view is already backed by an `ArrayBuffer` (the only
 * case that occurs with Tauri-sourced data); copies into a fresh buffer only
 * if the input is backed by a `SharedArrayBuffer`.
 */
export function asArrayBufferBacked(view: Uint8Array): Uint8Array<ArrayBuffer> {
  if (view.buffer instanceof ArrayBuffer) {
    // Sound: runtime-verified that the backing buffer is an ArrayBuffer.
    return view as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(view);
}
