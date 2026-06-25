// H1/H4 — CSP construction by trust state.
import { describe, it, expect } from "vitest";
import { buildCsp, SECURITY_HEADERS } from "./headers";

describe("buildCsp", () => {
  it("untrusted forbids remote images", () => {
    const csp = buildCsp(false);
    expect(csp).toContain("img-src 'self' data:;"); // no https in img-src
    expect(csp).toContain("connect-src 'self'"); // SSE
    expect(csp).toContain("object-src 'none'");
  });

  it("trusted allows https images", () => {
    expect(buildCsp(true)).toContain("img-src 'self' data: https:");
  });

  it("permits the Tauri webview to frame the KB (grill M2)", () => {
    const csp = buildCsp(false);
    expect(csp).toContain("frame-ancestors 'self' tauri:");
  });

  it("ships nosniff + referrer policy", () => {
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("no-referrer");
  });
});
