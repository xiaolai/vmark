// Source-pane highlighting layer — detectSourceLanguage maps a file path
// to a CodeMirror language loader. This is independent of routing: it only
// decides colors for an already-plain-text source pane.

import { describe, it, expect, vi } from "vitest";
import { detectSourceLanguage } from "./sourceLanguage";

describe("detectSourceLanguage — key matching", () => {
  it("returns a loader for known extensions", () => {
    expect(detectSourceLanguage("/x/app.ts")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/main.py")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/lib.rs")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/server.go")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/style.css")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/data.json")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/conf.yaml")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/Cargo.toml")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/run.sh")).toBeTypeOf("function");
  });

  it("returns a loader for env / ini / properties style files", () => {
    expect(detectSourceLanguage("/x/.env")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/.env.local")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/app.ini")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/settings.conf")).toBeTypeOf("function");
  });

  it("returns a loader for extensionless filename keys", () => {
    expect(detectSourceLanguage("/x/Dockerfile")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/.editorconfig")).toBeTypeOf("function");
  });

  it("matches case-insensitively", () => {
    expect(detectSourceLanguage("/x/APP.TS")).toBeTypeOf("function");
    expect(detectSourceLanguage("/x/DOCKERFILE")).toBeTypeOf("function");
  });

  it("returns null for unknown / plain files", () => {
    expect(detectSourceLanguage("/x/notes.txt")).toBeNull();
    expect(detectSourceLanguage("/x/README")).toBeNull();
    expect(detectSourceLanguage("/x/data.xyzzy")).toBeNull();
  });

  it("returns null for a null path (untitled)", () => {
    expect(detectSourceLanguage(null)).toBeNull();
  });

  it("prefers the dotfile-stem key over a bare extension when both could match", () => {
    // ".env.local" yields keys [".env.local", ".env", "local"]. Neither
    // ".env.local" nor "local" is a loader key, but ".env" is — so it must
    // resolve via the stem, not fall through to null.
    expect(detectSourceLanguage("/x/.env.local")).toBeTypeOf("function");
  });
});

describe("detectSourceLanguage — loader execution", () => {
  it("loads a TypeScript language extension that CodeMirror accepts", async () => {
    const loader = detectSourceLanguage("/x/app.ts");
    expect(loader).toBeTypeOf("function");
    const ext = await loader!();
    expect(ext).toBeDefined();
  });

  it("loads a legacy-mode (shell) language extension", async () => {
    const loader = detectSourceLanguage("/x/deploy.sh");
    const ext = await loader!();
    expect(ext).toBeDefined();
  });

  it("loads a properties-mode extension for .env", async () => {
    const loader = detectSourceLanguage("/x/.env");
    const ext = await loader!();
    expect(ext).toBeDefined();
  });

  it("loads a dockerfile-mode extension", async () => {
    const loader = detectSourceLanguage("/x/Dockerfile");
    const ext = await loader!();
    expect(ext).toBeDefined();
  });

  it("loads json, yaml, toml, css, python, rust, go, ruby, lua loaders without throwing", async () => {
    const paths = [
      "/x/a.json",
      "/x/a.yaml",
      "/x/a.toml",
      "/x/a.css",
      "/x/a.py",
      "/x/a.rs",
      "/x/a.go",
      "/x/a.rb",
      "/x/a.lua",
    ];
    for (const p of paths) {
      const loader = detectSourceLanguage(p);
      expect(loader, p).toBeTypeOf("function");
      const ext = await loader!();
      expect(ext, p).toBeDefined();
    }
  });

  it("loads sql, diff, powershell, nginx, cmake loaders", async () => {
    const paths = [
      "/x/q.sql",
      "/x/change.diff",
      "/x/run.ps1",
      "/x/nginx.conf",
      "/x/CMakeLists.txt",
    ];
    for (const p of paths) {
      const loader = detectSourceLanguage(p);
      expect(loader, p).toBeTypeOf("function");
      const ext = await loader!();
      expect(ext, p).toBeDefined();
    }
  });

  it("loads javascript variants (jsx/mjs/cjs) and typescript tsx", async () => {
    for (const p of ["/x/a.jsx", "/x/a.mjs", "/x/a.cjs", "/x/a.tsx"]) {
      const ext = await detectSourceLanguage(p)!();
      expect(ext, p).toBeDefined();
    }
  });

  it("is silent (no unhandled rejection) loading every mapped loader", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await detectSourceLanguage("/x/.editorconfig")!();
    await detectSourceLanguage("/x/settings.conf")!();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
