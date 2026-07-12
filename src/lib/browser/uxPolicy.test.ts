// WI-1.7 / R12 — browser UX surface policy: the decided per-surface matrix
import { describe, it, expect } from "vitest";
import {
  UX_POLICY,
  UX_SURFACES,
  dispositionFor,
  isPermissionSurface,
  aiMayChooseUploadFile,
  isTlsClickThroughAllowed,
  isDevtoolsAllowed,
} from "./uxPolicy";

describe("R12 per-surface dispositions", () => {
  it("routes JS dialogs to native VMark dialogs", () => {
    for (const s of ["alert", "confirm", "prompt"] as const) {
      expect(dispositionFor(s)).toBe("native-dialog");
    }
  });

  it("opens window.open / target=_blank as a new VMark tab (never a real popup)", () => {
    expect(dispositionFor("window-open")).toBe("new-tab");
  });

  it("confirms download destinations (never auto-writes)", () => {
    expect(dispositionFor("download")).toBe("confirm-destination");
  });

  it("makes file upload human-only — the AI may never choose a file", () => {
    expect(dispositionFor("file-upload")).toBe("human-picker");
    expect(aiMayChooseUploadFile()).toBe(false);
  });

  it("hard-denies TLS/cert errors with no click-through in v1", () => {
    expect(dispositionFor("tls-error")).toBe("deny-hard");
    expect(isTlsClickThroughAllowed()).toBe(false);
  });

  it("silently denies all permission prompts in v1", () => {
    for (const s of [
      "permission-camera",
      "permission-mic",
      "permission-geolocation",
      "permission-notifications",
    ] as const) {
      expect(dispositionFor(s)).toBe("deny-silent");
      expect(isPermissionSurface(s)).toBe(true);
    }
    expect(isPermissionSurface("download")).toBe(false);
  });

  it("implements history/find/zoom and a minimal context menu", () => {
    for (const s of ["back", "forward", "reload", "stop", "find", "zoom"] as const) {
      expect(dispositionFor(s)).toBe("implement");
    }
    expect(dispositionFor("context-menu")).toBe("implement-minimal");
  });

  it("marks print explicitly unsupported (a decision, not a silent gap)", () => {
    expect(dispositionFor("print")).toBe("unsupported");
  });

  it("enables devtools in debug builds only", () => {
    expect(dispositionFor("devtools")).toBe("debug-only");
    expect(isDevtoolsAllowed(true)).toBe(true);
    expect(isDevtoolsAllowed(false)).toBe(false);
  });

  it("assigns a decided disposition to EVERY surface — no TBD (R12)", () => {
    for (const s of UX_SURFACES) {
      expect(UX_POLICY[s]).toBeDefined();
    }
    // and no surface is left as a placeholder
    expect(Object.values(UX_POLICY).every((d) => d !== "tbd")).toBe(true);
  });
});
