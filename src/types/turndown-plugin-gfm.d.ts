declare module "@joplin/turndown-plugin-gfm" {
  import TurndownService from "turndown";
  type TurndownPlugin = (service: TurndownService) => void;
  export const gfm: TurndownPlugin;
  export const tables: TurndownPlugin;
  export const strikethrough: TurndownPlugin;
  export const taskListItems: TurndownPlugin;
  export const highlightedCodeBlock: TurndownPlugin;
}
