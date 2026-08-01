/**
 * The paste plugins' own vocabulary and its standalone default.
 *
 * @coordinates-with plugins/shared/pasteSettings.ts
 * @module plugins/shared/pasteSettings.test
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_PASTE_SETTINGS } from "./pasteSettings";
import { codePasteExtension } from "@/plugins/codePaste/tiptap";
import { htmlPasteExtension } from "@/plugins/htmlPaste/tiptap";

describe("a host that configures nothing still gets sane paste behaviour", () => {
  it("defaults to smart paste with breaks not preserved", () => {
    expect(DEFAULT_PASTE_SETTINGS).toEqual({ pasteMode: "smart", preserveLineBreaks: false });
  });

  it.each([
    ["codePaste", codePasteExtension],
    ["htmlPaste", htmlPasteExtension],
  ])("%s falls back to it rather than shipping dead", (_name, extension) => {
    // A plugin lifted out of this repo has no settings store to read. The
    // default is what makes it a working extension rather than a no-op.
    const options = extension.config.addOptions!.call({} as never) as {
      getPasteSettings: () => unknown;
    };
    expect(options.getPasteSettings()).toEqual(DEFAULT_PASTE_SETTINGS);
  });
});
