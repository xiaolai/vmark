/**
 * Minimal PNG pixel reader for E2E oracles — Node built-ins only.
 *
 * WHY THIS EXISTS. The occlusion invariant (B14) cannot be asserted from inside
 * the webview: the native `WKWebView` is a SIBLING of the Tauri webview, so it
 * appears in no DOM snapshot. The only witness is a native screenshot, and a
 * screenshot is only evidence if you can read PIXELS out of it. Asserting
 * "`browser_freeze` was invoked" or "`hidden` is true" would be an assertion that
 * cannot fail — it restates the action instead of observing its effect.
 *
 * WHY NOT A LIBRARY. `pngjs` exists in the store but is not a direct dependency,
 * and adding one for a test helper is a liability that needs justifying (every
 * new npm dep is also slopsquatting surface — see rule 60 §4). PNG decoding for
 * the screenshot case is ~60 lines against Node's own `zlib`, so the dependency
 * is not worth its cost.
 *
 * SCOPE — deliberately narrow. Handles the 8-bit RGB/RGBA non-interlaced form
 * that screenshot encoders emit. Anything else throws LOUDLY rather than
 * returning plausible-looking wrong pixels, because a silently-misread image
 * would produce a colour assertion that is confidently incorrect.
 *
 * @module e2e/lib/png
 */

import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Paeth predictor (PNG spec 9.4). */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode a PNG buffer into `{ width, height, channels, data }`, where `data` is
 * un-filtered raw samples (row-major, `channels` bytes per pixel).
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length; // length + type + data + crc
  }

  // Fail loudly on anything outside the supported form (see SCOPE).
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`unsupported PNG colour type: ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  // Reverse the per-scanline filters (PNG spec 9.2).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      switch (filter) {
        case 0: cur[x] = v; break;
        case 1: cur[x] = (v + a) & 0xff; break;
        case 2: cur[x] = (v + b) & 0xff; break;
        case 3: cur[x] = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: cur[x] = (v + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`unknown PNG filter type ${filter} on row ${y}`);
      }
    }
  }

  return { width, height, channels, data: out };
}

/** `{r,g,b}` at a pixel. Coordinates are clamped into the image. */
export function pixelAt(img, x, y) {
  const px = Math.min(Math.max(Math.round(x), 0), img.width - 1);
  const py = Math.min(Math.max(Math.round(y), 0), img.height - 1);
  const i = py * img.width * img.channels + px * img.channels;
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
}

/**
 * Share of sampled pixels in a rect that match `target` within `tolerance`.
 *
 * A ratio rather than a single probe: one pixel can land on a scrollbar, a
 * caret, or a subpixel-antialiased edge and be wrong about the whole region.
 * Coordinates are FRACTIONS of the image (0..1) so a caller does not need to
 * know the backing scale factor — a Retina screenshot is 2x the CSS geometry,
 * and hard-coding either would silently sample the wrong place on the other.
 */
export function colorRatioInRect(img, rect, target, tolerance = 24, steps = 12) {
  let hit = 0;
  let total = 0;
  for (let iy = 0; iy < steps; iy++) {
    for (let ix = 0; ix < steps; ix++) {
      const fx = rect.x + (rect.w * (ix + 0.5)) / steps;
      const fy = rect.y + (rect.h * (iy + 0.5)) / steps;
      const { r, g, b } = pixelAt(img, fx * img.width, fy * img.height);
      total++;
      if (
        Math.abs(r - target.r) <= tolerance &&
        Math.abs(g - target.g) <= tolerance &&
        Math.abs(b - target.b) <= tolerance
      ) {
        hit++;
      }
    }
  }
  return total === 0 ? 0 : hit / total;
}
