// @vitest-environment node
// WI-FL5.8 — toastIcons: the severity → icon map sonner renders (ledger F7,
// resilient-chrome). One icon per kind sonner knows; anything else falls back
// to sonner's own default because the map simply has no entry for it.
import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AlertCircle, AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react";
import { TOAST_ICONS } from "./toastIcons";

const SONNER_KINDS = ["error", "info", "loading", "success", "warning"] as const;

describe("TOAST_ICONS", () => {
  it("covers exactly sonner's five severities — no `close` override, no unknown kinds", () => {
    expect(Object.keys(TOAST_ICONS).sort()).toEqual([...SONNER_KINDS]);
    expect("close" in TOAST_ICONS).toBe(false);
    expect("default" in TOAST_ICONS).toBe(false);
  });

  it("maps each kind to the intended lucide glyph, and error to a `!` circle rather than an X", () => {
    expect(TOAST_ICONS.success.type).toBe(CheckCircle);
    expect(TOAST_ICONS.info.type).toBe(Info);
    expect(TOAST_ICONS.warning.type).toBe(AlertTriangle);
    expect(TOAST_ICONS.error.type).toBe(AlertCircle);
    // An X-in-a-circle would read as a second close button beside sonner's own.
    expect(TOAST_ICONS.error.type).not.toBe(XCircle);
  });

  it("every lucide icon is the same 16 px, so the severity ramp lines up", () => {
    for (const kind of ["success", "info", "warning", "error"] as const) {
      const icon = TOAST_ICONS[kind] as { props: { size?: number } };
      expect(icon.props.size).toBe(16);
    }
  });

  it("loading is the CSS spinner, not a lucide glyph", () => {
    expect(TOAST_ICONS.loading.type).toBe("span");
    expect(renderToStaticMarkup(TOAST_ICONS.loading)).toBe('<span class="vm-spinner"></span>');
  });

  it("each entry is a renderable element that produces a 16 px svg (or the spinner span)", () => {
    for (const kind of SONNER_KINDS) {
      const element = TOAST_ICONS[kind];
      expect(isValidElement(element)).toBe(true);
      const markup = renderToStaticMarkup(element);
      if (kind === "loading") {
        expect(markup).toContain("vm-spinner");
      } else {
        expect(markup).toMatch(/^<svg /);
        expect(markup).toContain('width="16"');
        expect(markup).toContain('height="16"');
      }
    }
  });
});
