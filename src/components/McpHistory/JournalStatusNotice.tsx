/**
 * Journal status notice — the history panel's statement of whether this
 * document's changes are being recorded (`journalStatusLines.ts`); renders
 * nothing when all is well.
 *
 * @coordinates-with components/McpHistory/journalStatusLines.ts — the lines
 * @module components/McpHistory/JournalStatusNotice
 */

import { useTranslation } from "react-i18next";
import { journalStatusLines, type StatusInput } from "./journalStatusLines";

export function JournalStatusNotice(props: StatusInput): React.ReactElement | null {
  const { t } = useTranslation("statusbar");
  const lines = journalStatusLines(props);
  if (lines.length === 0) return null;
  return (
    <div role="status" className="mcp-history-status">
      {lines.map((line) => (
        <p key={line.key} className={`mcp-history-status__line mcp-history-status__line--${line.tone}`}>
          {line.values ? t(line.key, line.values) : t(line.key)}
        </p>
      ))}
    </div>
  );
}
