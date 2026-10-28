/**
 * Actor label — who made a recorded change, as the history panel shows it:
 * the provider or principal state, then the connection, session label and
 * the client's self-chosen name as separate details.
 *
 * @coordinates-with components/McpHistory/historyLabels.ts — the words and tone
 * @module components/McpHistory/ActorLabel
 */

import { useTranslation } from "react-i18next";
import type { JournalActor } from "@/services/agentJournal/journalActor";
import { actorParts } from "./historyLabels";

export function ActorLabel({ actor }: { actor: JournalActor }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const parts = actorParts(actor, t);
  return (
    <span className="mcp-history-actor" data-tone={parts.tone}>
      <span className="mcp-history-actor__who">{parts.who}</span>
      {parts.details.map((detail) => (
        <span key={detail} className="mcp-history-actor__detail">
          {detail}
        </span>
      ))}
    </span>
  );
}
