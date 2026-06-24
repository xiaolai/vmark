import { describe, it, expect } from "vitest";
import {
  processExitedLine,
  pressAnyKeyToRestartLine,
  failedToStartLine,
  pressAnyKeyToRetryLine,
  restartingLine,
} from "./terminalMessages";

// The i18n singleton is mocked in src/test/setup.ts to resolve real English
// strings from the editor namespace, so these assertions exercise the actual
// interpolation and CRLF framing each builder is responsible for.

describe("terminalMessages", () => {
  it("frames the process-exited line with interpolated code and surrounding CRLFs", () => {
    expect(processExitedLine(137)).toBe(
      "\r\n[Process exited with code 137]\r\n",
    );
  });

  it("interpolates a zero exit code", () => {
    expect(processExitedLine(0)).toBe("\r\n[Process exited with code 0]\r\n");
  });

  it("renders the restart prompt with a trailing CRLF", () => {
    expect(pressAnyKeyToRestartLine()).toBe(
      "Press any key to restart...\r\n",
    );
  });

  it("frames the failed-to-start line with the error and surrounding CRLFs", () => {
    expect(failedToStartLine("ENOENT")).toBe(
      "\r\nFailed to start shell: ENOENT\r\n",
    );
  });

  it("renders the retry prompt with a trailing CRLF", () => {
    expect(pressAnyKeyToRetryLine()).toBe("Press any key to retry...\r\n");
  });

  it("frames the restarting notice with surrounding CRLFs", () => {
    expect(restartingLine()).toBe("\r\nRestarting shell...\r\n");
  });
});
