/**
 * Regression: every WebGL texture slot must end each frame holding the atlas
 * page that currently occupies it.
 *
 * @xterm/addon-webgl 0.19.0 re-uploads slot i only when
 * `pages[i].version !== glTexture.version`, and each AtlasPage counts its
 * own version from 0. Page merges replace the page at a slot (a fresh merged
 * page is always version 1; shifted pages go version+1), so a different page
 * can arrive with the version the slot already records. The upload is
 * skipped, the GPU keeps the previous page's image, and every glyph on the
 * new page samples unrelated pixels — fragment garble that selection only
 * masks (new colors → new raster keys) and Reset Display heals (it bumps all
 * page versions). Fixed by patches/@xterm__addon-webgl@0.19.0.patch, which
 * backports upstream's globally monotonic AtlasPage.version.
 *
 * Why real WebKit: jsdom mocks xterm and has no WebGL. The probe reads
 * addon-private fields; if they move, the guards below fail loudly — which
 * also means the addon changed and the patch needs re-checking.
 *
 * @coordinates-with patches/@xterm__addon-webgl@0.19.0.patch — global page versions
 * @coordinates-with setupWebglRenderer.ts — header records the patch's exit condition
 */
import "@xterm/xterm/css/xterm.css";
import { describe, it, expect } from "vitest";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

interface AtlasPage { canvas: HTMLCanvasElement; version: number }
interface Atlas { pages: AtlasPage[] }
interface GlyphRenderer {
  _atlasTextures: { version: number }[];
  render(model: unknown): void;
  _bindAtlasPageTexture(gl: unknown, atlas: Atlas, i: number): void;
}
interface WebglRenderer { _charAtlas?: Atlas; _glyphRenderer: { value?: GlyphRenderer } }
interface TermInternals { _core: { _renderService: { _renderer: { value?: WebglRenderer } } } }

const LINES = 600;
const GLYPHS_PER_LINE = 30;
const LINES_PER_WRITE = 12;

const twoFrames = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** One line of unique (CJK code point × 256-color fg × plain/italic/bold) raster keys. */
function floodLine(n: number, firstCodePoint: number): string {
  const style = ["", "\x1b[3m", "\x1b[1m"][Math.floor(n / 216) % 3];
  const fg = 16 + (n % 216);
  const glyphs = Array.from({ length: GLYPHS_PER_LINE }, (_, k) =>
    String.fromCodePoint(firstCodePoint + k));
  return `${style}\x1b[38;5;${fg}m${String(n).padStart(4, "0")} ${glyphs.join("")}\x1b[0m`;
}

describe("WebGL atlas page upload (addon-webgl 0.19.0 version collision)", () => {
  it("keeps every texture slot in sync with its page across repeated page merges", async () => {
    const host = document.createElement("div");
    host.style.cssText = "width: 1000px; height: 640px;";
    document.body.appendChild(host);
    const term = new Terminal({
      cols: 96,
      rows: 30,
      // 28px at DPR 1 ≈ a 14px Retina glyph: big enough that the flood
      // fills 16 atlas pages and merges several times within LINES.
      fontSize: 28,
      fontFamily: "Menlo, 'PingFang SC', 'Noto Sans CJK SC', 'WenQuanYi Zen Hei', monospace",
    });
    term.open(host);
    const addon = new WebglAddon();
    term.loadAddon(addon);

    try {
      const renderer = (term as unknown as TermInternals)._core._renderService._renderer.value;
      const glyphRenderer = renderer?._glyphRenderer?.value;
      expect(glyphRenderer, "WebGL glyph renderer must be active (is WebGL2 available?)").toBeDefined();
      expect(renderer?._charAtlas?.pages, "addon-private atlas fields moved").toBeDefined();
      if (!renderer || !glyphRenderer) return;

      // Record which page object each slot last received; check after every frame.
      // Seeded from slots already in sync, in case a frame ran before the wrap.
      const uploaded: (AtlasPage | undefined)[] = (renderer._charAtlas?.pages ?? []).map((p, i) =>
        glyphRenderer._atlasTextures[i]?.version === p.version ? p : undefined);
      const staleSlots = new Set<string>();
      let merges = 0;
      let lastPageCount = 0;

      const bind = glyphRenderer._bindAtlasPageTexture;
      glyphRenderer._bindAtlasPageTexture = function (gl, atlas, i) {
        bind.call(this, gl, atlas, i);
        uploaded[i] = atlas.pages[i];
      };
      const render = glyphRenderer.render;
      glyphRenderer.render = function (model) {
        render.call(this, model);
        const pages = renderer._charAtlas?.pages ?? [];
        if (pages.length < lastPageCount) merges++;
        lastPageCount = pages.length;
        const slots = Math.min(pages.length, this._atlasTextures.length);
        for (let i = 0; i < slots; i++) {
          if (uploaded[i] !== pages[i]) {
            staleSlots.add(`slot ${i}: page v${pages[i].version}, GPU v${this._atlasTextures[i].version}`);
          }
        }
      };

      let codePoint = 0x4e00;
      let batch = "";
      for (let n = 0; n < LINES; n++) {
        batch += floodLine(n, codePoint) + "\r\n";
        codePoint += GLYPHS_PER_LINE;
        // Paced: one huge write is coalesced into a single frame and only the
        // final viewport would ever be rasterized into the atlas.
        if ((n + 1) % LINES_PER_WRITE === 0) {
          await new Promise<void>((r) => term.write(batch, r));
          batch = "";
          await twoFrames();
        }
      }

      // Precondition: without ≥ 2 merges the collision cannot occur, and a
      // green result would be vacuous (e.g. fonts missing → empty glyphs).
      expect(merges, "flood must force at least two atlas page merges").toBeGreaterThanOrEqual(2);
      expect([...staleSlots]).toEqual([]);
    } finally {
      addon.dispose();
      term.dispose();
      host.remove();
    }
  }, 120_000);
});
