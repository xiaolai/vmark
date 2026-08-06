/**
 * Purpose: the XSS vector corpus swept across EVERY sanitizer entry point.
 *
 * `sanitize.test.ts` tests hand-picked vectors against the entry point each
 * one is about. That leaves the cross-product uncovered: a vector proven
 * dead in `sanitizeSvg` says nothing about `sanitizeMediaHtml`, and the
 * allow-lists differ per function — which is exactly where a hole hides.
 * This list is swept across all five in `sanitizerCrossProduct.test.ts`.
 *
 * Vectors are grouped by mechanism so a new entry lands next to its family
 * rather than at the end of an undifferentiated list.
 *
 * @coordinates-with sanitizerCrossProduct.test.ts — the sweep
 * @coordinates-with ../sanitize.ts — the five entry points
 * @module utils/__tests__/sanitizerVectors
 */

export interface XssVector {
  /** Stable id — failures name it. */
  id: string;
  /** What the payload tries to do. */
  mechanism: string;
  input: string;
}

export const XSS_VECTORS: readonly XssVector[] = [
  // --- Script elements ---
  { id: "script-plain", mechanism: "script element", input: "<script>alert(1)</script>" },
  { id: "script-mixed-case", mechanism: "script element", input: "<ScRiPt>alert(1)</ScRiPt>" },
  { id: "script-src", mechanism: "script element", input: '<script src="https://evil.test/x.js"></script>' },
  { id: "script-in-svg", mechanism: "script element", input: "<svg><script>alert(1)</script></svg>" },
  { id: "script-in-foreignobject", mechanism: "script element", input: "<svg><foreignObject><script>alert(1)</script></foreignObject></svg>" },
  { id: "script-nested-g", mechanism: "script element", input: "<svg><g><g><script>alert(1)</script></g></g></svg>" },
  { id: "script-broken-tag", mechanism: "script element", input: "<scr<script>ipt>alert(1)</script>" },

  // --- Inline event handlers ---
  { id: "onerror-img", mechanism: "event handler", input: '<img src=x onerror="alert(1)">' },
  { id: "onerror-unquoted", mechanism: "event handler", input: "<img src=x onerror=alert(1)>" },
  { id: "onload-svg", mechanism: "event handler", input: '<svg onload="alert(1)"><rect/></svg>' },
  { id: "onload-body", mechanism: "event handler", input: '<body onload="alert(1)">text</body>' },
  { id: "onclick-div", mechanism: "event handler", input: '<div onclick="alert(1)">click</div>' },
  { id: "onmouseover-mixed-case", mechanism: "event handler", input: '<p OnMouseOver="alert(1)">hover</p>' },
  { id: "onfocus-autofocus", mechanism: "event handler", input: '<input autofocus onfocus="alert(1)">' },
  { id: "onanimationstart", mechanism: "event handler", input: '<div style="animation-name:x" onanimationstart="alert(1)">x</div>' },
  { id: "ontoggle-details", mechanism: "event handler", input: '<details open ontoggle="alert(1)"><summary>s</summary></details>' },
  { id: "onerror-in-foreignobject", mechanism: "event handler", input: '<svg><foreignObject><img src=x onerror="alert(1)"></foreignObject></svg>' },

  // --- javascript: URLs ---
  { id: "js-href", mechanism: "javascript: URL", input: '<a href="javascript:alert(1)">x</a>' },
  { id: "js-href-entity-dec", mechanism: "javascript: URL", input: '<a href="&#106;avascript:alert(1)">x</a>' },
  { id: "js-href-entity-hex", mechanism: "javascript: URL", input: '<a href="&#x6A;avascript:alert(1)">x</a>' },
  { id: "js-href-whitespace", mechanism: "javascript: URL", input: '<a href="java\tscript:alert(1)">x</a>' },
  { id: "js-href-newline", mechanism: "javascript: URL", input: '<a href="java\nscript:alert(1)">x</a>' },
  { id: "js-href-mixed-case", mechanism: "javascript: URL", input: '<a href="JaVaScRiPt:alert(1)">x</a>' },
  { id: "js-xlink-href", mechanism: "javascript: URL", input: '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>' },
  { id: "js-form-action", mechanism: "javascript: URL", input: '<form action="javascript:alert(1)"><button>go</button></form>' },
  { id: "js-iframe-src", mechanism: "javascript: URL", input: '<iframe src="javascript:alert(1)"></iframe>' },

  // --- data: URLs ---
  { id: "data-html-href", mechanism: "data: URL", input: '<a href="data:text/html,<script>alert(1)</script>">x</a>' },
  { id: "data-html-base64", mechanism: "data: URL", input: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>' },
  { id: "data-iframe", mechanism: "data: URL", input: '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>' },
  { id: "data-object", mechanism: "data: URL", input: '<object data="data:text/html,<script>alert(1)</script>"></object>' },
  { id: "data-embed", mechanism: "data: URL", input: '<embed src="data:text/html,<script>alert(1)</script>">' },

  // --- CSS-borne execution ---
  { id: "css-expression", mechanism: "CSS", input: '<div style="width:expression(alert(1))">x</div>' },
  { id: "css-url-javascript", mechanism: "CSS", input: '<div style="background:url(javascript:alert(1))">x</div>' },
  { id: "css-moz-binding", mechanism: "CSS", input: '<div style="-moz-binding:url(https://evil.test/x.xml#x)">x</div>' },
  { id: "css-behavior", mechanism: "CSS", input: '<div style="behavior:url(#default#userData)">x</div>' },
  { id: "style-element", mechanism: "CSS", input: "<style>body{background:url(javascript:alert(1))}</style>" },
  { id: "style-import", mechanism: "CSS", input: '<style>@import url("https://evil.test/x.css");</style>' },

  // --- External / embedded resource loaders ---
  { id: "iframe-external", mechanism: "resource loader", input: '<iframe src="https://evil.test/"></iframe>' },
  { id: "object-swf", mechanism: "resource loader", input: '<object data="https://evil.test/x.swf"></object>' },
  { id: "embed-external", mechanism: "resource loader", input: '<embed src="https://evil.test/x.swf">' },
  { id: "svg-use-external", mechanism: "resource loader", input: '<svg><use href="https://evil.test/x.svg#y"/></svg>' },
  { id: "svg-use-xlink-external", mechanism: "resource loader", input: '<svg><use xlink:href="https://evil.test/x.svg#y"/></svg>' },
  { id: "svg-image-external", mechanism: "resource loader", input: '<svg><image href="https://evil.test/x.png"/></svg>' },
  { id: "meta-refresh", mechanism: "resource loader", input: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">' },
  { id: "base-href", mechanism: "resource loader", input: '<base href="https://evil.test/">' },
  { id: "link-stylesheet", mechanism: "resource loader", input: '<link rel="stylesheet" href="https://evil.test/x.css">' },

  // --- SVG-specific animation / scripting surfaces ---
  { id: "svg-animate-href", mechanism: "SVG animation", input: '<svg><a><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>' },
  { id: "svg-set-onload", mechanism: "SVG animation", input: '<svg><set attributeName="onload" to="alert(1)"/></svg>' },
  { id: "svg-handler", mechanism: "SVG scripting", input: '<svg><handler type="text/javascript">alert(1)</handler></svg>' },
  { id: "svg-listener", mechanism: "SVG scripting", input: '<svg><listener event="load" handler="#h"/></svg>' },

  // --- Parser-confusion / mXSS shapes ---
  { id: "mxss-noscript", mechanism: "mXSS", input: "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">x</p></noscript>" },
  { id: "mxss-svg-style-comment", mechanism: "mXSS", input: "<svg></p><style><a id=\"</style><img src=x onerror=alert(1)>\"></style></svg>" },
  { id: "mxss-form-nested", mechanism: "mXSS", input: '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>' },
  { id: "mxss-template", mechanism: "mXSS", input: "<template><script>alert(1)</script></template>" },
  { id: "mxss-xmp", mechanism: "mXSS", input: "<xmp><img src=x onerror=alert(1)></xmp>" },
  { id: "mxss-comment-break", mechanism: "mXSS", input: "<!--<img src=x onerror=alert(1)>-->" },
  { id: "mxss-cdata", mechanism: "mXSS", input: "<![CDATA[<script>alert(1)</script>]]>" },

  // --- Frame/DOM-clobbering and form hijack ---
  { id: "clobber-name-body", mechanism: "DOM clobbering", input: '<img name="body" src=x>' },
  { id: "clobber-id-attributes", mechanism: "DOM clobbering", input: '<form id="attributes"><input name="x"></form>' },
  { id: "formaction", mechanism: "form hijack", input: '<button formaction="javascript:alert(1)">go</button>' },
  { id: "srcdoc-iframe", mechanism: "form hijack", input: '<iframe srcdoc="<script>alert(1)</script>"></iframe>' },
];
