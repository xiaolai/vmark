import { describe, it, expect, vi } from "vitest";
import { isOperationInProgress, withReentryGuard } from "./reentryGuard";

function createBlocker() {
  let resolveFn: () => void;
  const promise = new Promise<void>((r) => {
    resolveFn = r;
  });
  return { promise, resolve: () => resolveFn() };
}

describe("reentryGuard", () => {
  describe("isOperationInProgress", () => {
    it("returns false when no operation is in progress", () => {
      expect(isOperationInProgress("window1", "save")).toBe(false);
    });

    it("returns true while an operation is running", async () => {
      const blocker = createBlocker();
      const op = withReentryGuard("window1", "save", async () => {
        await blocker.promise;
      });

      expect(isOperationInProgress("window1", "save")).toBe(true);

      blocker.resolve();
      await op;
    });

    it("returns false for different window with same operation", async () => {
      const blocker = createBlocker();
      const op = withReentryGuard("window1", "save", async () => {
        await blocker.promise;
      });

      expect(isOperationInProgress("window2", "save")).toBe(false);

      blocker.resolve();
      await op;
    });

    it("returns false for same window with different operation", async () => {
      const blocker = createBlocker();
      const op = withReentryGuard("window1", "save", async () => {
        await blocker.promise;
      });

      expect(isOperationInProgress("window1", "open")).toBe(false);

      blocker.resolve();
      await op;
    });

    it("returns false after the operation completes", async () => {
      await withReentryGuard("window1", "save", async () => "done");
      expect(isOperationInProgress("window1", "save")).toBe(false);
    });
  });

  describe("withReentryGuard", () => {
    it("executes function and returns result", async () => {
      const result = await withReentryGuard("window1", "save", async () => {
        return "success";
      });

      expect(result).toBe("success");
    });

    it("releases lock after function completes", async () => {
      await withReentryGuard("window1", "save", async () => "done");

      expect(isOperationInProgress("window1", "save")).toBe(false);
    });

    it("returns undefined when operation is already in progress", async () => {
      const blocker = createBlocker();
      const fn = vi.fn().mockResolvedValue("should not run");

      const first = withReentryGuard("window1", "save", async () => {
        await blocker.promise;
        return "first";
      });

      const result = await withReentryGuard("window1", "save", fn);

      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();

      blocker.resolve();
      await first;
    });

    it("releases lock even when function throws (cleanup does not throw)", async () => {
      await expect(
        withReentryGuard("window1", "save", async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");

      expect(isOperationInProgress("window1", "save")).toBe(false);

      // Lock is fully released — a subsequent call can acquire it again.
      const result = await withReentryGuard("window1", "save", async () => "ok");
      expect(result).toBe("ok");
    });

    it("allows concurrent operations on different windows", async () => {
      const results: string[] = [];

      const p1 = withReentryGuard("window1", "save", async () => {
        results.push("window1-start");
        await new Promise((r) => setTimeout(r, 10));
        results.push("window1-end");
        return "window1";
      });

      const p2 = withReentryGuard("window2", "save", async () => {
        results.push("window2-start");
        await new Promise((r) => setTimeout(r, 5));
        results.push("window2-end");
        return "window2";
      });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe("window1");
      expect(r2).toBe("window2");
      expect(results).toContain("window1-start");
      expect(results).toContain("window2-start");
    });

    it("allows different operations on same window concurrently", async () => {
      const results: string[] = [];

      const p1 = withReentryGuard("window1", "save", async () => {
        results.push("save-start");
        await new Promise((r) => setTimeout(r, 10));
        results.push("save-end");
        return "save";
      });

      const p2 = withReentryGuard("window1", "open", async () => {
        results.push("open-start");
        await new Promise((r) => setTimeout(r, 5));
        results.push("open-end");
        return "open";
      });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe("save");
      expect(r2).toBe("open");
    });

    it("prevents re-entry during async operation", async () => {
      const callCount = { value: 0 };
      const blocker = createBlocker();

      // Start first operation (will block)
      const p1 = withReentryGuard("window1", "save", async () => {
        callCount.value++;
        await blocker.promise;
        return "first";
      });

      // Try to start second operation (should be blocked)
      const p2 = withReentryGuard("window1", "save", async () => {
        callCount.value++;
        return "second";
      });

      // Second should return undefined immediately
      const result2 = await p2;
      expect(result2).toBeUndefined();
      expect(callCount.value).toBe(1);

      // Complete first operation
      blocker.resolve();
      const result1 = await p1;
      expect(result1).toBe("first");
      expect(callCount.value).toBe(1);
    });

    it("handles synchronous return values", async () => {
      const result = await withReentryGuard("window1", "sync", async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it("handles void return", async () => {
      let executed = false;
      const result = await withReentryGuard("window1", "void", async () => {
        executed = true;
      });

      expect(executed).toBe(true);
      expect(result).toBeUndefined();
    });
  });

  describe("guard key composition", () => {
    it("uses window:operation format for uniqueness", async () => {
      const b1 = createBlocker();
      const b2 = createBlocker();

      const p1 = withReentryGuard("a", "b", async () => {
        await b1.promise;
      });
      const p2 = withReentryGuard("a:b", "", async () => {
        await b2.promise;
      });

      expect(isOperationInProgress("a", "b")).toBe(true);
      expect(isOperationInProgress("a:b", "")).toBe(true);

      b1.resolve();
      b2.resolve();
      await Promise.all([p1, p2]);
    });

    it("handles special characters in window labels", async () => {
      const b1 = createBlocker();
      const b2 = createBlocker();

      const p1 = withReentryGuard("window-1", "save", async () => {
        await b1.promise;
      });
      const p2 = withReentryGuard("window_2", "save", async () => {
        await b2.promise;
      });

      expect(isOperationInProgress("window-1", "save")).toBe(true);
      expect(isOperationInProgress("window_2", "save")).toBe(true);

      b1.resolve();
      b2.resolve();
      await Promise.all([p1, p2]);
    });
  });
});
