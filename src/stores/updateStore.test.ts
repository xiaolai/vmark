/**
 * Tests for updateStore
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useUpdateStore } from "./updateStore";

describe("updateStore", () => {
  beforeEach(() => {
    useUpdateStore.getState().reset();
  });

  describe("setError and setStatus interaction", () => {
    it("setError sets both error message and status to error", () => {
      const { setError } = useUpdateStore.getState();

      setError("Something went wrong");

      const state = useUpdateStore.getState();
      expect(state.error).toBe("Something went wrong");
      expect(state.status).toBe("error");
    });

    it("setStatus(error) preserves existing error message", () => {
      const { setError, setStatus } = useUpdateStore.getState();

      setError("Original error");
      setStatus("error");

      const state = useUpdateStore.getState();
      expect(state.error).toBe("Original error");
      expect(state.status).toBe("error");
    });

    it("setStatus to non-error clears error message", () => {
      const { setError, setStatus } = useUpdateStore.getState();

      setError("Some error");
      setStatus("checking");

      const state = useUpdateStore.getState();
      expect(state.error).toBeNull();
      expect(state.status).toBe("checking");
    });

    it("setError(null) clears error but preserves status", () => {
      const { setStatus, setError } = useUpdateStore.getState();

      setStatus("downloading");
      setError(null);

      const state = useUpdateStore.getState();
      expect(state.error).toBeNull();
      expect(state.status).toBe("downloading");
    });

    it("typical check flow: checking clears previous error", () => {
      const { setError, setStatus } = useUpdateStore.getState();

      // Simulate previous failed check
      setError("Network error");
      expect(useUpdateStore.getState().status).toBe("error");

      // Start new check
      setStatus("checking");

      const state = useUpdateStore.getState();
      expect(state.error).toBeNull();
      expect(state.status).toBe("checking");
    });
  });

  describe("dismiss and clearDismissed", () => {
    it("dismiss sets dismissed to true", () => {
      const { dismiss } = useUpdateStore.getState();

      dismiss();

      expect(useUpdateStore.getState().dismissed).toBe(true);
    });

    it("clearDismissed resets dismissed to false", () => {
      const { dismiss, clearDismissed } = useUpdateStore.getState();

      dismiss();
      expect(useUpdateStore.getState().dismissed).toBe(true);

      clearDismissed();
      expect(useUpdateStore.getState().dismissed).toBe(false);
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", () => {
      const { setError, setStatus, setUpdateInfo, dismiss, reset } = useUpdateStore.getState();

      setError("Error");
      setStatus("error");
      setUpdateInfo({ version: "1.0.0", notes: "", pubDate: "", currentVersion: "0.9.0" });
      dismiss();

      reset();

      const state = useUpdateStore.getState();
      expect(state.status).toBe("idle");
      expect(state.error).toBeNull();
      expect(state.updateInfo).toBeNull();
      expect(state.dismissed).toBe(false);
    });
  });
});
