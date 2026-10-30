// The reader's page widgets, run as code against a real export: the code-block
// line-number and copy buttons, the image lightbox, back-to-top, the reading
// progress bar and the TOC's scroll-spy. The settings panel is
// `readerControls.test.ts`; footnotes are `readerFootnotes.test.ts`.
//
// jsdom lays nothing out, so geometry the widgets read (`scrollY`,
// `scrollHeight`, `offsetTop`, an image's `naturalWidth`) is set explicitly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, closeExport, exportedMarkdown, openExport } from "./readerHarness";

function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`reader did not render ${selector}`);
  return el;
}

function setNumber(target: object, key: string, value: number): void {
  Object.defineProperty(target, key, { configurable: true, get: () => value });
}

function scrollTo(y: number): void {
  setNumber(window, "scrollY", y);
  window.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  setNumber(window, "scrollY", 0);
});

afterEach(() => {
  closeExport();
  vi.useRealTimers();
});

describe("code-block buttons", () => {
  const CODE = "```js\nconst a = 1;\nconst b = 2;\n```";

  it("hides line numbers by default and toggles them, keeping the label in step", () => {
    const editor = openExport(exportedMarkdown(CODE));
    const lineNumbers = must<HTMLElement>(".code-line-numbers", editor);
    const toggle = must<HTMLButtonElement>('.vmark-code-btn[aria-label="Show line numbers"]', editor);
    expect(lineNumbers.style.display).toBe("none");

    click(toggle);
    expect(lineNumbers.style.display).toBe("flex");
    expect(toggle.getAttribute("aria-label")).toBe("Hide line numbers");

    click(toggle);
    expect(lineNumbers.style.display).toBe("none");
    expect(toggle.getAttribute("aria-label")).toBe("Show line numbers");
  });

  it("copies the block's code and flashes the confirmation", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const editor = openExport(exportedMarkdown(CODE));
    const copy = must<HTMLButtonElement>('.vmark-code-btn[aria-label="Copy code"]', editor);

    click(copy);
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("const a = 1;\nconst b = 2;");
    expect(copy.classList.contains("copied")).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.classList.contains("copied")).toBe(false);
  });

  it("adds one button group per block, however often settings re-apply", () => {
    const editor = openExport(exportedMarkdown(`${CODE}\n\n${CODE}`));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));

    expect(editor.querySelectorAll(".vmark-code-btn-group")).toHaveLength(2);
  });
});

describe("image lightbox", () => {
  const IMAGE = "Text\n\n![A chart](https://example.com/chart.png)";

  beforeEach(() => {
    setNumber(HTMLImageElement.prototype, "naturalWidth", 400);
  });

  // jsdom's own accessors, put back after each test rather than deleted.
  const native = (key: "naturalWidth" | "complete") =>
    Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key)!;
  const originals = { naturalWidth: native("naturalWidth"), complete: native("complete") };

  afterEach(() => {
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", originals.naturalWidth);
    Object.defineProperty(HTMLImageElement.prototype, "complete", originals.complete);
  });

  it("opens an image full-size from a click or Enter, and closes on Escape or the backdrop", () => {
    const editor = openExport(exportedMarkdown(IMAGE));
    const img = must<HTMLImageElement>("img", editor);
    const box = must<HTMLElement>(".vmark-lightbox");
    expect(img.getAttribute("role")).toBe("button");

    click(img);
    expect(box.classList.contains("visible")).toBe(true);
    expect(must<HTMLImageElement>(".vmark-lightbox-img").getAttribute("src")).toBe("https://example.com/chart.png");
    expect(must<HTMLImageElement>(".vmark-lightbox-img").alt).toBe("A chart");
    expect(document.activeElement).toBe(must(".vmark-lightbox-close"));
    expect(document.body.style.overflow).toBe("hidden");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box.classList.contains("visible")).toBe(false);
    expect(document.body.style.overflow).toBe("");

    img.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(box.classList.contains("visible")).toBe(true);
    click(box);
    expect(box.classList.contains("visible")).toBe(false);
  });

  it("leaves a loaded tiny image (an icon or badge) alone", () => {
    setNumber(HTMLImageElement.prototype, "naturalWidth", 20);
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    const editor = openExport(exportedMarkdown(IMAGE));

    click(must("img", editor));

    expect(must(".vmark-lightbox").classList.contains("visible")).toBe(false);
    expect(must("img", editor).hasAttribute("role")).toBe(false);
  });
});

describe("back to top and reading progress", () => {
  it("shows back-to-top only past 300px and scrolls to the top when pressed", () => {
    openExport(exportedMarkdown("# Long\n\nBody."));
    const button = must<HTMLButtonElement>(".vmark-back-to-top");
    expect(button.classList.contains("visible")).toBe(false);

    scrollTo(301);
    expect(button.classList.contains("visible")).toBe(true);
    click(button);
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));

    scrollTo(300);
    expect(button.classList.contains("visible")).toBe(false);
  });

  it("fills the progress bar with the share of the page scrolled", () => {
    setNumber(document.documentElement, "scrollHeight", 3000);
    setNumber(window, "innerHeight", 1000);
    openExport(exportedMarkdown("# Long\n\nBody."));
    const bar = must<HTMLElement>(".vmark-progress-bar");
    const fill = must<HTMLElement>(".vmark-progress-fill");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");

    scrollTo(500);
    expect(fill.style.width).toBe("25%");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");

    scrollTo(2000);
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
  });

  it("reads a page shorter than the window as unscrolled", () => {
    setNumber(document.documentElement, "scrollHeight", 500);
    setNumber(window, "innerHeight", 1000);
    openExport(exportedMarkdown("Short."));

    expect(must(".vmark-progress-bar").getAttribute("aria-valuenow")).toBe("0");
  });
});

describe("TOC scroll-spy", () => {
  it("marks the last heading at or above the reading line as current", () => {
    const editor = openExport(exportedMarkdown("# One\n\nA.\n\n## Two\n\nB.\n\n## Three\n\nC."));
    const headings = Array.from(editor.querySelectorAll<HTMLElement>("h1, h2"));
    headings.forEach((h, i) => setNumber(h, "offsetTop", i * 1000));
    const active = () =>
      Array.from(document.querySelectorAll(".vmark-toc-item.active"), (a) => a.textContent);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(active()).toEqual(["One"]);

    scrollTo(950); // "Two" is within the 100px reading offset
    expect(active()).toEqual(["Two"]);

    scrollTo(5000);
    expect(active()).toEqual(["Three"]);

    // Closing the TOC stops the spy: scrolling no longer moves the mark.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    scrollTo(0);
    expect(active()).toEqual(["Three"]);
  });
});
