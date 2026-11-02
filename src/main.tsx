/**
 * main — the webview entry point: loads i18n, global styles and KaTeX CSS,
 * then bootstraps the app and lazily imports App.
 *
 * @module main
 */

import "./i18n";
import "./services/menu/startupMenuSync";
import { bootstrap } from "./bootstrap";
import "./styles/index.css";
// Canonical `.vm-btn` text button. Global so any surface can use it instead of
// hand-rolling another bespoke `__btn` class (see the file header).
import "./styles/button-shared.css";
import "./styles/icon-button-shared.css";
import "./styles/overlay-shared.css";
import "./styles/input-shared.css";
import "./styles/panel-shared.css";
import "./styles/select-shared.css";
import "./styles/chrome-selection.css";
// KaTeX CSS must load AFTER Tailwind (so preflight runs first).
// KaTeX fixes must load AFTER KaTeX CSS to restore border-widths reset by Tailwind.
import "katex/dist/katex.min.css";
import "./styles/katexFixes.css";
import { appError } from "@/utils/debug";

// The startup sequence lives in ./bootstrap. The App import stays HERE, in the
// entry: it is the boot chunk the eager-chunk gate seeds from, and it must be
// a dynamic import so App's stores evaluate only after bootstrap has filled
// the secure-storage cache.
void bootstrap(() => import("./App")).catch((e) => appError("App bootstrap failed:", e));
