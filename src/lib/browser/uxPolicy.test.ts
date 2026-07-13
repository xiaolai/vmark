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
  type UxDisposition,
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

  it("routes basic-auth to a native prompt (the exact decided disposition)", () => {
    expect(dispositionFor("basic-auth")).toBe("native-prompt");
  });

  it("keeps the no-AI-upload and no-TLS-click-through invariants unconditional (not matrix-derived)", () => {
    // These are security invariants, not policy lookups: a future retint of the matrix
    // must never be able to flip them. They answer `false` regardless of any disposition.
    expect(aiMayChooseUploadFile()).toBe(false);
    expect(isTlsClickThroughAllowed()).toBe(false);
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
    // "tbd" is not even a UxDisposition — R12 forbids deferring the decision, and
    // the type system, not a runtime check, is what makes that impossible.
    // @ts-expect-error — "tbd" must not be assignable to UxDisposition
    const placeholder: UxDisposition = "tbd";
    expect(placeholder).toBe("tbd");
  });

  it("derives UX_SURFACES from UX_POLICY so the two cannot drift", () => {
    // A surface added to the policy is automatically in the list — no manual copy.
    expect([...UX_SURFACES].sort()).toEqual(Object.keys(UX_POLICY).sort());
  });

  it("classifies permission surfaces by identity, not by their current disposition", () => {
    for (const s of UX_SURFACES) {
      expect(isPermissionSurface(s)).toBe(s.startsWith("permission-"));
    }
  });
});
