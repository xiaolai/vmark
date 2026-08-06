import { useWikiLinkPopupStore } from "../wikiLinkPopupStore";
import type { AnchorRect } from "@/utils/popupPosition";

const mockRect: AnchorRect = {
  top: 100,
  left: 200,
  bottom: 120,
  right: 300,
};

beforeEach(() => {
  useWikiLinkPopupStore.getState().closePopup();
});

describe("wikiLinkPopupStore", () => {
  it("initializes with popup closed", () => {
    const state = useWikiLinkPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.anchorRect).toBeNull();
    expect(state.target).toBe("");
    expect(state.nodePos).toBeNull();
  });

  it("openPopup sets all fields", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "MyPage", 42);
    const state = useWikiLinkPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.anchorRect).toBe(mockRect);
    expect(state.target).toBe("MyPage");
    expect(state.nodePos).toBe(42);
  });

  it("closePopup resets to initial state", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "SomePage", 10);
    useWikiLinkPopupStore.getState().closePopup();
    const state = useWikiLinkPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.anchorRect).toBeNull();
    expect(state.target).toBe("");
    expect(state.nodePos).toBeNull();
  });

  it("updateTarget changes only the target field", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "OldTarget", 5);
    useWikiLinkPopupStore.getState().updateTarget("NewTarget");
    const state = useWikiLinkPopupStore.getState();
    expect(state.target).toBe("NewTarget");
    // Other fields remain unchanged
    expect(state.isOpen).toBe(true);
    expect(state.anchorRect).toBe(mockRect);
    expect(state.nodePos).toBe(5);
  });

  it("updateTarget works with empty string", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "HasTarget", 1);
    useWikiLinkPopupStore.getState().updateTarget("");
    expect(useWikiLinkPopupStore.getState().target).toBe("");
  });

  it("openPopup overwrites previous state", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "First", 1);
    const newRect: AnchorRect = { top: 50, left: 60, bottom: 70, right: 80 };
    useWikiLinkPopupStore.getState().openPopup(newRect, "Second", 99);
    const state = useWikiLinkPopupStore.getState();
    expect(state.target).toBe("Second");
    expect(state.nodePos).toBe(99);
    expect(state.anchorRect).toBe(newRect);
  });

  it("updateTarget with special characters", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "", 0);
    useWikiLinkPopupStore.getState().updateTarget("Page/Sub Page#Heading");
    expect(useWikiLinkPopupStore.getState().target).toBe("Page/Sub Page#Heading");
  });

  it("updateTarget with CJK characters", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "", 0);
    useWikiLinkPopupStore.getState().updateTarget("\u7B14\u8BB0\u9875\u9762");
    expect(useWikiLinkPopupStore.getState().target).toBe("\u7B14\u8BB0\u9875\u9762");
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("wikiLinkPopupStore — T09 revert contract pins", () => {
  const initialData = { isOpen: false, anchorRect: null, target: "", nodePos: null };

  function dataOf(s: ReturnType<typeof useWikiLinkPopupStore.getState>) {
    const { isOpen, anchorRect, target, nodePos } = s;
    return { isOpen, anchorRect, target, nodePos };
  }

  it("no leak across sessions: open A → updateTarget → close → open B shows only B", () => {
    useWikiLinkPopupStore.getState().openPopup(mockRect, "A", 1);
    useWikiLinkPopupStore.getState().updateTarget("A-edited");
    useWikiLinkPopupStore.getState().closePopup();

    const rectB: AnchorRect = { top: 5, left: 6, bottom: 7, right: 8 };
    useWikiLinkPopupStore.getState().openPopup(rectB, "B", 9);

    expect(dataOf(useWikiLinkPopupStore.getState())).toEqual({
      isOpen: true,
      anchorRect: rectB,
      target: "B",
      nodePos: 9,
    });
  });

  it("updateTarget while closed still mutates (pinned legacy behavior: setters are unguarded)", () => {
    useWikiLinkPopupStore.getState().updateTarget("closed edit");
    const state = useWikiLinkPopupStore.getState();
    expect(state.target).toBe("closed edit");
    expect(state.isOpen).toBe(false);
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useWikiLinkPopupStore.getState().openPopup(mockRect, `t${i}`, i);
      useWikiLinkPopupStore.getState().closePopup();
    }
    expect(dataOf(useWikiLinkPopupStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useWikiLinkPopupStore.getState().openPopup(mockRect, "mutated", 3);
      expect(dataOf(useWikiLinkPopupStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useWikiLinkPopupStore.getState().openPopup(mockRect, "open", 3);
      useWikiLinkPopupStore.setState(useWikiLinkPopupStore.getInitialState());
      expect(dataOf(useWikiLinkPopupStore.getState())).toEqual(initialData);
    });
  });
});
