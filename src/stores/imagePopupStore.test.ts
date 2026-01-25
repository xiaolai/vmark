import { beforeEach, describe, expect, it } from "vitest";
import { useImagePopupStore } from "./imagePopupStore";

const rect = { top: 0, left: 0, bottom: 10, right: 10 };

describe("imagePopupStore", () => {
  beforeEach(() => {
    useImagePopupStore.getState().closePopup();
  });

  it("opens with image data", () => {
    useImagePopupStore.getState().openPopup({
      imageSrc: "/path/to/image.png",
      imageAlt: "Test image",
      imageNodePos: 42,
      anchorRect: rect,
    });

    const state = useImagePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.imageSrc).toBe("/path/to/image.png");
    expect(state.imageAlt).toBe("Test image");
    expect(state.imageNodePos).toBe(42);
    expect(state.imageNodeType).toBe("image");
    expect(state.anchorRect).toEqual(rect);
  });

  it("opens with block_image type", () => {
    useImagePopupStore.getState().openPopup({
      imageSrc: "/path/to/image.png",
      imageAlt: "Block image",
      imageNodePos: 100,
      imageNodeType: "block_image",
      anchorRect: rect,
    });

    expect(useImagePopupStore.getState().imageNodeType).toBe("block_image");
  });

  it("updates src", () => {
    useImagePopupStore.getState().openPopup({
      imageSrc: "/old.png",
      imageAlt: "",
      imageNodePos: 0,
      anchorRect: rect,
    });
    useImagePopupStore.getState().setSrc("/new.png");

    expect(useImagePopupStore.getState().imageSrc).toBe("/new.png");
  });

  it("updates alt", () => {
    useImagePopupStore.getState().openPopup({
      imageSrc: "/test.png",
      imageAlt: "Old alt",
      imageNodePos: 0,
      anchorRect: rect,
    });
    useImagePopupStore.getState().setAlt("New alt");

    expect(useImagePopupStore.getState().imageAlt).toBe("New alt");
  });

  it("updates node type", () => {
    useImagePopupStore.getState().openPopup({
      imageSrc: "/test.png",
      imageAlt: "",
      imageNodePos: 0,
      anchorRect: rect,
    });
    useImagePopupStore.getState().setNodeType("block_image");

    expect(useImagePopupStore.getState().imageNodeType).toBe("block_image");
  });

  it("closes and resets state", () => {
    useImagePopupStore.getState().openPopup({
      imageSrc: "/test.png",
      imageAlt: "Test",
      imageNodePos: 50,
      imageNodeType: "block_image",
      anchorRect: rect,
    });
    useImagePopupStore.getState().closePopup();

    const state = useImagePopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.imageSrc).toBe("");
    expect(state.imageAlt).toBe("");
    expect(state.imageNodePos).toBe(-1);
    expect(state.imageNodeType).toBe("image");
    expect(state.anchorRect).toBeNull();
  });
});
