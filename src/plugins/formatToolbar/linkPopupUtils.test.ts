// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { LinkInfo } from "@/plugins/toolbarContext/types";
import { resolveLinkPopupPayload } from "./linkPopupUtils";

describe("resolveLinkPopupPayload", () => {
  it("prefers linkContext when provided", () => {
    const linkContext: LinkInfo = {
      href: "https://example.com",
      text: "link",
      from: 5,
      to: 12,
      contentFrom: 5,
      contentTo: 12,
    };

    const payload = resolveLinkPopupPayload({ from: 0, to: 0 }, linkContext);

    expect(payload).toEqual({
      href: "https://example.com",
      linkFrom: 5,
      linkTo: 12,
    });
  });

  it("uses selection when linkContext is missing", () => {
    const payload = resolveLinkPopupPayload({ from: 3, to: 9 }, null);

    expect(payload).toEqual({
      href: "",
      linkFrom: 3,
      linkTo: 9,
    });
  });

  it("returns null when selection is empty and no linkContext", () => {
    const payload = resolveLinkPopupPayload({ from: 4, to: 4 });

    expect(payload).toBeNull();
  });
});
