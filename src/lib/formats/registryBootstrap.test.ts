import { describe, it, expect, beforeEach } from "vitest";
import { rebootstrapFormats } from "./registryBootstrap";
import { dispatchEditor, getFormatById } from "./registry";

describe("registryBootstrap — media format", () => {
  beforeEach(() => {
    // rebootstrapFormats resets + re-registers; all-on by default.
    rebootstrapFormats();
  });

  it("registers the media format as always-on", () => {
    expect(getFormatById("media")?.kind).toBe("media");
  });

  it("routes a picture / video / audio path to the media viewer", () => {
    expect(dispatchEditor("/x/a.png").id).toBe("media");
    expect(dispatchEditor("/x/a.mp4").id).toBe("media");
    expect(dispatchEditor("/x/a.mp3").id).toBe("media");
  });

  it("leaves svg on its own format, not media", () => {
    expect(dispatchEditor("/x/icon.svg").id).toBe("svg");
  });
});
