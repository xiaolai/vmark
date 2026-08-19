# `scripts/assets/`

Binary assets committed because a generator needs them at run time, in an
environment that has no toolchain to build them.

## `comic-neue-subset.woff2`

Embedded into `.github/star-history.svg` by `scripts/gen-star-history.mjs` as a
`data:` URI `@font-face`. It is committed rather than fetched or subset during
the run because `.github/workflows/star-history.yml` runs on a bare Node 22
runner: no Python, no `fontTools`, and no reason to make a weekly chart refresh
depend on fonts.googleapis.com being reachable.

| | |
|---|---|
| Family | Comic Neue Regular |
| Upstream | [`google/fonts/ofl/comicneue`](https://github.com/google/fonts/tree/main/ofl/comicneue) — `ComicNeue-Regular.ttf` |
| License | **OFL 1.1**, no Reserved Font Name — see `comic-neue-OFL.txt` |
| Subset | ASCII printable (U+0020–U+007E) + em dash (U+2014) |
| Size | ~12 KB (107 glyphs), from a 57 KB full TTF |

The subset is ASCII-wide rather than exactly the glyphs in use, so renaming the
repository or relabelling an axis cannot silently produce a missing glyph.

### Why this font and not star-history.com's

star-history.com embeds **xkcd Script**, which is **CC BY-NC 3.0**. VMark is
ISC — a permissive license that grants downstream users the right to use the
work for any purpose, commercial included. Shipping an NC-restricted asset
inside it would purport to grant a right we do not hold. Comic Neue is OFL and
carries no such conflict.

### Regenerating the subset

Requires `fontTools` and `brotli` locally (neither is a project dependency):

```bash
python3 - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
chars = "".join(chr(c) for c in range(0x20, 0x7F)) + "—"
f = TTFont("ComicNeue-Regular.ttf")          # from google/fonts, ofl/comicneue
o = Options(); o.layout_features = ["*"]; o.notdef_outline = True; o.desubroutinize = True
s = Subsetter(options=o); s.populate(text=chars); s.subset(f)
f.flavor = "woff2"
f.save("scripts/assets/comic-neue-subset.woff2")
PY
```

`scripts/gen-star-history.test.mjs` asserts the committed bytes are a real
WOFF2 and that they appear verbatim in the rendered SVG, so a corrupted or
placeholder file fails the gate rather than shipping a chart in Times.

## `comic-neue-OFL.txt`

The upstream license, committed verbatim. OFL 1.1 requires the license and
copyright notice to accompany any distribution of the font — and base64-inlining
it into an SVG that ships in the README is distribution.
