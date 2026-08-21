// @vitest-environment node
// WI-CJKF6.2 — a refused format run must be visible to the user.
//
// `formatMarkdown` returns the ORIGINAL text when its integrity check fails,
// which is correct. But the only trace was `cjkFmtWarn`, a log-file logger, so
// the accelerator appeared to do nothing and "refused" was indistinguishable
// from "already formatted".

import { describe, it, expect, vi, beforeEach } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { notifyCjkFormatRefused } from "./cjkFormatFeedback";

beforeEach(() => toastError.mockClear());

describe("notifyCjkFormatRefused", () => {
  it("shows an error toast when the run was refused", () => {
    notifyCjkFormatRefused(true);
    expect(toastError).toHaveBeenCalledWith("dialog:toast.cjkFormatRefused");
  });

  it("says NOTHING when the run succeeded", () => {
    // A run that finds nothing to change is the normal outcome of pressing the
    // key twice. A toast for it would train the user to ignore the toast that
    // matters.
    notifyCjkFormatRefused(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("fires exactly once per call, not per segment", () => {
    notifyCjkFormatRefused(true);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
