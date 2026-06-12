import { describe, it, expect, vi, beforeEach } from "vitest";

const askMock = vi.fn();
const messageMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
  message: (...args: unknown[]) => messageMock(...args),
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, params?: Record<string, string>) => {
      if (!params) return key;
      let out = key;
      for (const [k, v] of Object.entries(params)) {
        out += `|${k}=${v}`;
      }
      return out;
    },
  },
}));

import { confirmOpenHugeFile, showHugeFileRefusal } from "./largeFilePrompts";

describe("confirmOpenHugeFile", () => {
  beforeEach(() => {
    askMock.mockReset();
    messageMock.mockReset();
  });

  it("returns true when the user confirms", async () => {
    askMock.mockResolvedValueOnce(true);
    const result = await confirmOpenHugeFile("/tmp/novel.md", 8 * 1024 * 1024);
    expect(result).toBe(true);
  });

  it("returns false when the user cancels", async () => {
    askMock.mockResolvedValueOnce(false);
    expect(await confirmOpenHugeFile("/tmp/novel.md", 8 * 1024 * 1024)).toBe(false);
  });

  it("passes formatted size into the body and basename into the title", async () => {
    askMock.mockResolvedValueOnce(true);
    await confirmOpenHugeFile("/home/user/docs/giant-log.md", 10 * 1024 * 1024);

    const [body, options] = askMock.mock.calls[0];
    expect(body).toContain("size=10.0 MB");
    expect((options as { title?: string }).title).toContain("filename=giant-log.md");
    expect((options as { kind?: string }).kind).toBe("warning");
  });

  it("handles Windows-style path separators when extracting the filename", async () => {
    askMock.mockResolvedValueOnce(true);
    await confirmOpenHugeFile("C:\\Users\\x\\Desktop\\big.md", 7 * 1024 * 1024);
    const [, options] = askMock.mock.calls[0];
    expect((options as { title?: string }).title).toContain("filename=big.md");
  });

  it("falls back to the raw input when the path has no separator", async () => {
    askMock.mockResolvedValueOnce(true);
    await confirmOpenHugeFile("bare-name.md", 6 * 1024 * 1024);
    const [, options] = askMock.mock.calls[0];
    expect((options as { title?: string }).title).toContain("filename=bare-name.md");
  });
});

describe("showHugeFileRefusal", () => {
  beforeEach(() => {
    askMock.mockReset();
    messageMock.mockReset();
  });

  it("uses error kind and passes filename + size + limit", async () => {
    messageMock.mockResolvedValueOnce(undefined);

    await showHugeFileRefusal("/tmp/monster.md", 80 * 1024 * 1024);

    expect(messageMock).toHaveBeenCalledOnce();
    const [body, options] = messageMock.mock.calls[0];
    expect(body).toContain("filename=monster.md");
    expect(body).toContain("size=80.0 MB");
    expect(body).toContain("limit=50.0 MB");
    expect((options as { kind?: string }).kind).toBe("error");
  });
});
