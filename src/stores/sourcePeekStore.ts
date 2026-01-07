import { create } from "zustand";

export interface SourcePeekRange {
  from: number;
  to: number;
}

export interface SourcePeekAnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface SourcePeekState {
  isOpen: boolean;
  markdown: string;
  range: SourcePeekRange | null;
  anchorRect: SourcePeekAnchorRect | null;
}

interface SourcePeekActions {
  open: (payload: { markdown: string; range: SourcePeekRange; anchorRect: SourcePeekAnchorRect }) => void;
  close: () => void;
  setMarkdown: (markdown: string) => void;
}

const initialState: SourcePeekState = {
  isOpen: false,
  markdown: "",
  range: null,
  anchorRect: null,
};

export const useSourcePeekStore = create<SourcePeekState & SourcePeekActions>((set) => ({
  ...initialState,
  open: ({ markdown, range, anchorRect }) => set({
    isOpen: true,
    markdown,
    range,
    anchorRect,
  }),
  close: () => set({ ...initialState }),
  setMarkdown: (markdown) => set({ markdown }),
}));
