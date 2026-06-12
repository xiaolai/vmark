/**
 * Tests for useMediaOperations
 *
 * Tests media file operations: copying video/audio to assets,
 * hash-based deduplication, large file handling, and ProseMirror node insertion.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock Tauri filesystem APIs
const mockCopyFile = vi.fn(() => Promise.resolve());
const mockReadFile = vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3])));
const mockWriteFile = vi.fn(() => Promise.resolve());
const mockStat = vi.fn(() => Promise.resolve({ size: 1000 }));

vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  mkdir: vi.fn(() => Promise.resolve()),
  exists: vi.fn(() => Promise.resolve(false)),
}));

// Mock image utilities
vi.mock("@/utils/imageUtils", () => ({
  generateUniqueFilename: vi.fn((name: string) => `unique-${name}`),
  getFilename: vi.fn((path: string) => path.split("/").pop() || "media.mp4"),
  buildAssetRelativePath: vi.fn((filename: string) => `assets/images/${filename}`),
}));

// Mock image hash
const mockComputeDataHash = vi.fn(() => Promise.resolve("mediahash123"));
vi.mock("@/utils/imageHash", () => ({
  computeDataHash: (...args: unknown[]) => mockComputeDataHash(...args),
}));

// Mock image hash registry
const mockFindExistingImage = vi.fn(() => Promise.resolve(null));
const mockRegisterImageHash = vi.fn(() => Promise.resolve());
vi.mock("@/services/media/imageHashRegistry", () => ({
  findExistingImage: (...args: unknown[]) => mockFindExistingImage(...args),
  registerImageHash: (...args: unknown[]) => mockRegisterImageHash(...args),
}));

// Mock ensureAssetsFolder
const mockEnsureAssetsFolder = vi.fn(() => Promise.resolve("/docs/assets/images"));
vi.mock("@/hooks/useImageOperations", () => ({
  ensureAssetsFolder: (...args: unknown[]) => mockEnsureAssetsFolder(...args),
}));

import {
  copyMediaToAssets,
  saveMediaToAssets,
  insertBlockVideoNode,
  insertBlockAudioNode,
} from "./useMediaOperations";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

// ProseMirror test schema with video and audio nodes
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    block_video: {
      group: "block",
      attrs: {
        src: { default: "" },
        title: { default: "" },
        poster: { default: "" },
        controls: { default: true },
        preload: { default: "metadata" },
      },
      parseDOM: [{ tag: "video" }],
      toDOM(node) { return ["video", node.attrs]; },
    },
    block_audio: {
      group: "block",
      attrs: {
        src: { default: "" },
        title: { default: "" },
        controls: { default: true },
        preload: { default: "metadata" },
      },
      parseDOM: [{ tag: "audio" }],
      toDOM(node) { return ["audio", node.attrs]; },
    },
    text: { group: "inline" },
  },
});

function createEditorState(text = "hello world") {
  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ]),
    schema,
  });
}

function createMockView(state: EditorState) {
  const dispatchFn = vi.fn();
  return {
    state,
    dispatch: dispatchFn,
  };
}

describe("copyMediaToAssets", () => {
  const FIFTY_MB = 50 * 1024 * 1024;

  beforeEach(() => {
    mockStat.mockReset().mockResolvedValue({ size: 1000 });
    mockReadFile.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockCopyFile.mockReset().mockResolvedValue(undefined);
    mockComputeDataHash.mockReset().mockResolvedValue("mediahash123");
    mockFindExistingImage.mockReset().mockResolvedValue(null);
    mockRegisterImageHash.mockReset().mockResolvedValue(undefined);
    mockEnsureAssetsFolder.mockReset().mockResolvedValue("/docs/assets/images");
  });

  it("copies small file with hash-based dedup", async () => {
    mockStat.mockResolvedValue({ size: 1000 });

    const result = await copyMediaToAssets(
      "/external/video.mp4",
      "/docs/note.md"
    );

    expect(mockReadFile).toHaveBeenCalledWith("/external/video.mp4");
    expect(mockComputeDataHash).toHaveBeenCalled();
    expect(mockFindExistingImage).toHaveBeenCalledWith("/docs/note.md", "mediahash123");
    expect(mockCopyFile).toHaveBeenCalled();
    expect(mockRegisterImageHash).toHaveBeenCalled();
    expect(result).toBe("assets/images/unique-video.mp4");
  });

  it("returns existing path when duplicate found (small file)", async () => {
    mockStat.mockResolvedValue({ size: 1000 });
    mockFindExistingImage.mockResolvedValue("assets/images/existing-video.mp4");

    const result = await copyMediaToAssets(
      "/external/video.mp4",
      "/docs/note.md"
    );

    expect(mockCopyFile).not.toHaveBeenCalled();
    expect(result).toBe("assets/images/existing-video.mp4");
  });

  it("skips dedup for files larger than 50MB", async () => {
    mockStat.mockResolvedValue({ size: FIFTY_MB + 1 });

    const result = await copyMediaToAssets(
      "/external/bigvideo.mp4",
      "/docs/note.md"
    );

    // Should NOT read file for hashing
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockComputeDataHash).not.toHaveBeenCalled();
    // Should still copy
    expect(mockCopyFile).toHaveBeenCalled();
    expect(result).toBe("assets/images/unique-bigvideo.mp4");
  });

  it("performs dedup for files exactly at 50MB threshold", async () => {
    mockStat.mockResolvedValue({ size: FIFTY_MB });

    await copyMediaToAssets("/external/exact.mp4", "/docs/note.md");

    // Exactly 50MB should still do dedup
    expect(mockReadFile).toHaveBeenCalled();
    expect(mockComputeDataHash).toHaveBeenCalled();
  });

  it("registers hash after successful copy (small file)", async () => {
    mockStat.mockResolvedValue({ size: 1000 });

    await copyMediaToAssets("/external/audio.wav", "/docs/note.md");

    expect(mockRegisterImageHash).toHaveBeenCalledWith(
      "/docs/note.md",
      "mediahash123",
      "assets/images/unique-audio.wav"
    );
  });

  it("does not register hash for large files (no dedup)", async () => {
    mockStat.mockResolvedValue({ size: FIFTY_MB + 1 });

    await copyMediaToAssets("/external/big.mp4", "/docs/note.md");

    expect(mockRegisterImageHash).not.toHaveBeenCalled();
  });
});

describe("saveMediaToAssets", () => {
  beforeEach(() => {
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockComputeDataHash.mockReset().mockResolvedValue("datahash456");
    mockFindExistingImage.mockReset().mockResolvedValue(null);
    mockRegisterImageHash.mockReset().mockResolvedValue(undefined);
    mockEnsureAssetsFolder.mockReset().mockResolvedValue("/docs/assets/images");
  });

  it("saves binary data to assets folder", async () => {
    const data = new Uint8Array([10, 20, 30, 40]);

    const result = await saveMediaToAssets(
      data,
      "recording.wav",
      "/docs/note.md"
    );

    expect(mockComputeDataHash).toHaveBeenCalledWith(data);
    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockRegisterImageHash).toHaveBeenCalled();
    expect(result).toBe("assets/images/unique-recording.wav");
  });

  it("returns existing path when duplicate data found", async () => {
    mockFindExistingImage.mockResolvedValue("assets/images/existing-recording.wav");

    const data = new Uint8Array([10, 20, 30]);
    const result = await saveMediaToAssets(data, "recording.wav", "/docs/note.md");

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRegisterImageHash).not.toHaveBeenCalled();
    expect(result).toBe("assets/images/existing-recording.wav");
  });

  it("registers hash for future deduplication", async () => {
    const data = new Uint8Array([1, 2]);

    await saveMediaToAssets(data, "clip.mp3", "/docs/note.md");

    expect(mockRegisterImageHash).toHaveBeenCalledWith(
      "/docs/note.md",
      "datahash456",
      "assets/images/unique-clip.mp3"
    );
  });
});

describe("insertBlockVideoNode", () => {
  it("inserts block_video node at selection", () => {
    const state = createEditorState("hello world");
    const view = createMockView(state);

    insertBlockVideoNode(view as never, "assets/images/video.mp4");

    expect(view.dispatch).toHaveBeenCalled();
    const tr = view.dispatch.mock.calls[0][0];
    expect(tr).toBeDefined();
  });

  it("creates node with correct attributes", () => {
    const state = createEditorState("hello");
    const view = createMockView(state);

    insertBlockVideoNode(view as never, "video.mp4", "My Video", "poster.jpg");

    const tr = view.dispatch.mock.calls[0][0];
    // The inserted node should have the specified attributes
    const insertedNodes: Array<{ type: { name: string }; attrs: Record<string, unknown> }> = [];
    tr.doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
      if (node.type.name === "block_video") insertedNodes.push(node);
    });
    expect(insertedNodes).toHaveLength(1);
    expect(insertedNodes[0].attrs.src).toBe("video.mp4");
    expect(insertedNodes[0].attrs.title).toBe("My Video");
    expect(insertedNodes[0].attrs.poster).toBe("poster.jpg");
    expect(insertedNodes[0].attrs.controls).toBe(true);
    expect(insertedNodes[0].attrs.preload).toBe("metadata");
  });

  it("does nothing when block_video type not in schema", () => {
    const noVideoSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    const state = EditorState.create({
      doc: noVideoSchema.node("doc", null, [
        noVideoSchema.node("paragraph", null, [noVideoSchema.text("hello")]),
      ]),
    });
    const view = createMockView(state);

    insertBlockVideoNode(view as never, "video.mp4");

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("uses default empty values for title and poster", () => {
    const state = createEditorState("hello");
    const view = createMockView(state);

    insertBlockVideoNode(view as never, "video.mp4");

    const tr = view.dispatch.mock.calls[0][0];
    const videoNodes: Array<{ attrs: Record<string, unknown> }> = [];
    tr.doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
      if (node.type.name === "block_video") videoNodes.push(node);
    });
    expect(videoNodes[0].attrs.title).toBe("");
    expect(videoNodes[0].attrs.poster).toBe("");
  });
});

describe("insertBlockAudioNode", () => {
  it("inserts block_audio node at selection", () => {
    const state = createEditorState("hello world");
    const view = createMockView(state);

    insertBlockAudioNode(view as never, "assets/images/audio.mp3");

    expect(view.dispatch).toHaveBeenCalled();
  });

  it("creates node with correct attributes", () => {
    const state = createEditorState("hello");
    const view = createMockView(state);

    insertBlockAudioNode(view as never, "audio.mp3", "My Audio");

    const tr = view.dispatch.mock.calls[0][0];
    const audioNodes: Array<{ attrs: Record<string, unknown> }> = [];
    tr.doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
      if (node.type.name === "block_audio") audioNodes.push(node);
    });
    expect(audioNodes).toHaveLength(1);
    expect(audioNodes[0].attrs.src).toBe("audio.mp3");
    expect(audioNodes[0].attrs.title).toBe("My Audio");
    expect(audioNodes[0].attrs.controls).toBe(true);
    expect(audioNodes[0].attrs.preload).toBe("metadata");
  });

  it("does nothing when block_audio type not in schema", () => {
    const noAudioSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    const state = EditorState.create({
      doc: noAudioSchema.node("doc", null, [
        noAudioSchema.node("paragraph", null, [noAudioSchema.text("hello")]),
      ]),
    });
    const view = createMockView(state);

    insertBlockAudioNode(view as never, "audio.mp3");

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("uses default empty title", () => {
    const state = createEditorState("hello");
    const view = createMockView(state);

    insertBlockAudioNode(view as never, "audio.mp3");

    const tr = view.dispatch.mock.calls[0][0];
    const audioNodes: Array<{ attrs: Record<string, unknown> }> = [];
    tr.doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
      if (node.type.name === "block_audio") audioNodes.push(node);
    });
    expect(audioNodes[0].attrs.title).toBe("");
  });
});
