import type { FormatType } from "./formatTypes";

const SHORTCUT_MAP: Record<string, FormatType> = {
  b: "bold",
  i: "italic",
  u: "underline",
  k: "link",
  s: "strikethrough",
  h: "highlight",
  "`": "code",
};

export function resolveSourceFormatShortcut(key: string): FormatType | null {
  const normalized = key.toLowerCase();
  return SHORTCUT_MAP[normalized] ?? null;
}
