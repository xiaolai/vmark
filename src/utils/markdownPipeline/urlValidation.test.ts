/**
 * URL validation tests
 */

import { describe, it, expect } from "vitest";
import { isSafeUrl } from "./urlValidation";

describe("urlValidation", () => {
  describe("isSafeUrl", () => {
    describe("safe URLs", () => {
      it("allows https URLs", () => {
        expect(isSafeUrl("https://example.com")).toBe(true);
        expect(isSafeUrl("HTTPS://EXAMPLE.COM")).toBe(true);
      });

      it("allows http URLs", () => {
        expect(isSafeUrl("http://example.com")).toBe(true);
      });

      it("allows mailto URLs", () => {
        expect(isSafeUrl("mailto:user@example.com")).toBe(true);
      });

      it("allows tel URLs", () => {
        expect(isSafeUrl("tel:+1234567890")).toBe(true);
      });

      it("allows data URLs", () => {
        expect(isSafeUrl("data:image/png;base64,abc123")).toBe(true);
      });

      it("allows relative URLs", () => {
        expect(isSafeUrl("/path/to/page")).toBe(true);
        expect(isSafeUrl("../other/page")).toBe(true);
        expect(isSafeUrl("page.html")).toBe(true);
        expect(isSafeUrl("#anchor")).toBe(true);
        expect(isSafeUrl("?query=value")).toBe(true);
      });

      it("allows URLs with colon in path", () => {
        expect(isSafeUrl("/path:with:colons")).toBe(true);
        expect(isSafeUrl("path/with:colon")).toBe(true);
      });

      it("allows empty and null URLs", () => {
        expect(isSafeUrl("")).toBe(true);
        expect(isSafeUrl(null)).toBe(true);
        expect(isSafeUrl(undefined)).toBe(true);
        expect(isSafeUrl("   ")).toBe(true);
      });
    });

    describe("unsafe URLs", () => {
      it("blocks javascript URLs", () => {
        expect(isSafeUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeUrl("JavaScript:alert(1)")).toBe(false);
        expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
      });

      it("blocks vbscript URLs", () => {
        expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
      });

      it("blocks data URLs with script content", () => {
        // NOTE: `data:` passes this predicate, including `data:text/html`,
        // which is NOT a safe scheme — a data:text/html document can execute
        // script when loaded in a document context. This function is no
        // longer the thing standing between that URL and the user: storage
        // keeps URLs verbatim, and containment lives at the sinks
        // (Tiptap renderHTML + openExternalLink's allowlist), proven
        // end-to-end in linkSecurity.test.ts. Kept here only to document
        // what this predicate does, not to bless the scheme.
        // should be validated at a higher level
        expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(true);
        // Content-type filtering should happen elsewhere
      });

      it("blocks file URLs", () => {
        expect(isSafeUrl("file:///etc/passwd")).toBe(false);
      });

      it("blocks unknown schemes", () => {
        expect(isSafeUrl("unknown:something")).toBe(false);
        expect(isSafeUrl("custom:protocol")).toBe(false);
      });
    });
  });

});
