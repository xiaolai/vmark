// @vitest-environment node
// Trusted-HTML IPC bridge (issue #1273).

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import {
  grantTrustedHtml,
  publishTrustedHtml,
  revokeTrustedHtml,
} from "./trustedHtmlBridge";

const TOKEN = "a".repeat(64);
const PATH = "/labs/thermometer.html";

beforeEach(() => {
  invoke.mockReset();
  useHtmlTrustStore.getState().clearAll();
});

describe("grantTrustedHtml", () => {
  it("mints a grant and records it against the path", async () => {
    invoke.mockResolvedValue(TOKEN);

    const token = await grantTrustedHtml(PATH, "<p>hi</p>");

    expect(invoke).toHaveBeenCalledWith("trusted_html_grant", { html: "<p>hi</p>" });
    expect(token).toBe(TOKEN);
    expect(useHtmlTrustStore.getState().tokenFor(PATH)).toBe(TOKEN);
  });

  /// An untitled buffer has no identity to attach a grant to. Refusing here
  /// keeps the backend from minting a grant nothing can later revoke.
  it("refuses a pathless document without calling the backend", async () => {
    await expect(grantTrustedHtml(null, "<p>hi</p>")).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not record a grant when the backend refuses", async () => {
    invoke.mockRejectedValue({ code: "invalid-input", message: "too large" });

    await expect(grantTrustedHtml(PATH, "x")).rejects.toBeDefined();
    expect(useHtmlTrustStore.getState().tokenFor(PATH)).toBeNull();
  });

  it("rejects a malformed token rather than storing it", async () => {
    invoke.mockResolvedValue("not-a-token");

    await expect(grantTrustedHtml(PATH, "<p>hi</p>")).rejects.toThrow();
    expect(useHtmlTrustStore.getState().tokenFor(PATH)).toBeNull();
  });
});

describe("publishTrustedHtml", () => {
  it("republishes against the live token", async () => {
    invoke.mockResolvedValue(undefined);

    await publishTrustedHtml(TOKEN, "<p>v2</p>");

    expect(invoke).toHaveBeenCalledWith("trusted_html_publish", {
      token: TOKEN,
      html: "<p>v2</p>",
    });
  });
});

describe("revokeTrustedHtml", () => {
  it("revokes the backend grant and forgets the path", async () => {
    invoke.mockResolvedValue(undefined);
    useHtmlTrustStore.getState().grant(PATH, TOKEN);

    await revokeTrustedHtml(PATH);

    expect(invoke).toHaveBeenCalledWith("trusted_html_revoke", { token: TOKEN });
    expect(useHtmlTrustStore.getState().tokenFor(PATH)).toBeNull();
  });

  it("is a no-op for a path that was never trusted", async () => {
    await revokeTrustedHtml("/never.html");
    expect(invoke).not.toHaveBeenCalled();
  });

  /// Local trust must drop even if the backend call fails, so the UI can never
  /// show "trusted" for something it has stopped being able to revoke.
  it("forgets the path even when the backend revoke rejects", async () => {
    invoke.mockRejectedValue(new Error("bridge down"));
    useHtmlTrustStore.getState().grant(PATH, TOKEN);

    await revokeTrustedHtml(PATH);

    expect(useHtmlTrustStore.getState().tokenFor(PATH)).toBeNull();
  });
});
