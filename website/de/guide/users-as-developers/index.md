# Nutzer als Entwickler

Im Zeitalter der KI-Coding-Tools verschwindet die Grenze zwischen „Nutzer" und „Entwickler". Wenn Sie einen Fehler beschreiben können, können Sie ihn beheben. Wenn Sie sich eine Funktion vorstellen können, können Sie sie bauen — mit einem KI-Assistenten, der die Codebasis bereits versteht.

VMark begrüßt diese Philosophie. Das Repository wird mit Projektregeln, Architekturdokumenten und Konventionen geliefert, die für KI-Coding-Tools vorgeladen sind. Klonen Sie das Repository, öffnen Sie Ihren KI-Assistenten und fangen Sie an beizutragen — die KI weiß bereits, wie VMark funktioniert.

## Erste Schritte

1. **Repository klonen** — KI-Konfiguration ist bereits vorhanden.
2. **KI-Tool installieren** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex) oder [Gemini CLI](https://github.com/google-gemini/gemini-cli).
3. **Sitzung öffnen** — Das Tool liest `AGENTS.md` und die Regeln automatisch.
4. **Mit dem Coden beginnen** — Die KI kennt die Projektkonventionen, Testanforderungen und Architekturmuster.

Keine zusätzliche Einrichtung erforderlich. Fangen Sie einfach an, Ihre KI um Hilfe zu bitten.

## Leseleitfaden

Neu bei der KI-gestützten Entwicklung? Diese Seiten bauen aufeinander auf:

1. **[Warum ich VMark gebaut habe](/de/guide/users-as-developers/why-i-built-vmark)** — Die Reise eines Nicht-Programmierers von Skripten zu Desktop-Apps
2. **[Fünf grundlegende menschliche Fähigkeiten, die KI potenzieren](/de/guide/users-as-developers/what-are-indispensable)** — Git, TDD, Terminal-Kenntnisse, Englisch und Geschmack — die Grundlagen, auf denen alles andere aufbaut
3. **[Warum teurere Modelle günstiger sind](/de/guide/users-as-developers/why-expensive-models-are-cheaper)** — Der Preis pro Token ist eine Eitelkeitskennzahl; die Kosten pro Aufgabe sind das, was zählt
4. **[Abonnement vs. API-Preisgestaltung](/de/guide/users-as-developers/subscription-vs-api)** — Warum Pauschalabonnements die Pay-per-Token-Abrechnung für Coding-Sitzungen schlagen
5. **[Englische Prompts funktionieren besser](/de/guide/users-as-developers/prompt-refinement)** — Übersetzung, Verfeinerung und der `::`-Hook
6. **[Modellübergreifende Verifikation](/de/guide/users-as-developers/cross-model-verification)** — Claude und Codex gegenseitig prüfen lassen für besseren Code
7. **[Warum Issues, nicht PRs](/de/guide/users-as-developers/why-issues-not-prs)** — Warum wir Issues akzeptieren, aber keine Pull Requests in einer KI-gepflegten Codebasis
8. **[Kosten- und Aufwandsanalyse](/de/guide/users-as-developers/cost-evaluation)** — Was VMark mit einem menschlichen Team kosten würde vs. die Realität der KI-gestützten Entwicklung

Bereits mit den Grundlagen vertraut? Springen Sie zu [Modellübergreifende Verifikation](/de/guide/users-as-developers/cross-model-verification) für den fortgeschrittenen Arbeitsablauf, oder lesen Sie weiter, wie VMark's KI-Einrichtung unter der Haube funktioniert.

## Eine Datei, alle Tools

KI-Coding-Tools lesen jeweils ihre eigene Konfigurationsdatei:

| Tool | Konfigurationsdatei |
|------|---------------------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Dieselben Anweisungen an drei Orten zu pflegen ist fehleranfällig. VMark löst dies mit einer einzigen Wahrheitsquelle:

- **`AGENTS.md`** — Enthält alle Projektregeln, Konventionen und Architekturnotizen.
- **`CLAUDE.md`** — Nur eine Zeile: `@AGENTS.md` (eine Claude Code-Direktive, die die Datei einfügt).
- **Codex CLI** — Liest `AGENTS.md` direkt.
- **Gemini CLI** — Verwendet `@AGENTS.md` in `GEMINI.md`, um dieselbe Datei einzufügen.

`AGENTS.md` einmal aktualisieren, alle Tools übernehmen die Änderung.

::: tip Was ist `@AGENTS.md`?
Das `@`-Präfix ist eine Claude Code-Direktive, die den Inhalt einer anderen Datei einfügt. Es ähnelt `#include` in C — der Inhalt von `AGENTS.md` wird an dieser Position in `CLAUDE.md` eingefügt. Mehr erfahren auf [agents.md](https://agents.md/).
:::

## Codex als zweite Meinung nutzen

VMark verwendet modellübergreifende Verifikation — Claude schreibt den Code, dann prüft Codex (ein anderes KI-Modell von OpenAI) ihn unabhängig. Dies erkennt blinde Flecken, die ein einzelnes Modell möglicherweise übersieht. Vollständige Details und Einrichtungsanweisungen finden Sie unter [Modellübergreifende Verifikation](/de/guide/users-as-developers/cross-model-verification).

## Was die KI weiß

Wenn ein KI-Coding-Tool das VMark-Repository öffnet, erhält es automatisch:

### Projektregeln (`.claude/rules/`)

Diese Dateien werden in jede Claude Code-Sitzung automatisch geladen. Sie umfassen:

| Regel | Was sie durchsetzt |
|-------|-------------------|
| TDD-Workflow | Test-first ist obligatorisch; Coverage-Schwellenwerte blockieren den Build |
| Design-Tokens | Keine hartcodierten Farben — vollständige CSS-Token-Referenz enthalten |
| Komponentenmuster | Popup-, Symbolleisten-, Kontextmenü-Muster mit Code-Beispielen |
| Fokusindikatoren | Barrierefreiheit: Tastaturfokus muss immer sichtbar sein |
| Dunkles Design | `.dark-theme`-Selektorregeln, Token-Paritätsanforderungen |
| Tastaturkürzel | Drei-Datei-Synchronisierungsverfahren (Rust, TypeScript, Docs) |
| Versionserhöhungen | Fünf-Datei-Aktualisierungsverfahren |
| Codebasis-Konventionen | Store-, Hook-, Plugin-, Test- und Import-Muster |

### Benutzerdefinierte Skills

Slash-Befehle geben der KI spezialisierte Fähigkeiten:

| Befehl | Was er tut |
|--------|------------|
| `/fix` | Probleme richtig beheben — Ursachenanalyse, TDD, keine Patches |
| `/fix-issue` | End-to-End GitHub Issue-Löser (abrufen, verzweigen, beheben, prüfen, PR) |
| `/codex-audit` | Vollständiges 9-dimensionales Code-Audit (Sicherheit, Korrektheit, Compliance, ...) |
| `/codex-audit-mini` | Schnelle 5-dimensionale Prüfung für kleine Änderungen |
| `/codex-verify` | Fixes aus einem vorherigen Audit verifizieren |
| `/codex-commit` | Intelligente Commit-Nachrichten aus Änderungsanalyse |
| `/audit-fix` | Audit, alle Befunde beheben, verifizieren — wiederholen bis sauber |
| `/feature-workflow` | End-to-End gesteuerter Workflow mit spezialisierten Agenten |
| `/merge-prs` | Offene PRs sequenziell prüfen und zusammenführen |
| `/bump` | Versionserhöhung in allen 5 Dateien, committen, taggen, pushen |

### Spezialisierte Agenten

Für komplexe Aufgaben kann Claude Code an fokussierte Unteragenten delegieren:

| Agent | Rolle |
|-------|-------|
| Planer | Recherchiert bewährte Praktiken, brainstormt Edge Cases, erstellt modulare Pläne |
| Implementierer | TDD-gesteuertes Implementieren mit Vorab-Untersuchung |
| Prüfer | Überprüft Diffs auf Korrektheit und Regelverstöße |
| Test-Runner | Führt Gates aus, koordiniert E2E-Tests über Tauri MCP |
| Verifizierer | Abschließende Checkliste vor dem Release |

## Private Überschreibungen

Nicht alles gehört in die gemeinsame Konfiguration. Für persönliche Präferenzen:

| Datei | Geteilt? | Zweck |
|-------|---------|-------|
| `AGENTS.md` | Ja | Projektregeln für alle KI-Tools |
| `CLAUDE.md` | Ja | Claude Code-Einstiegspunkt |
| `.claude/settings.json` | Ja | Team-gemeinsame Berechtigungen |
| `CLAUDE.local.md` | **Nein** | Ihre persönlichen Anweisungen (gitignoriert) |
| `.claude/settings.local.json` | **Nein** | Ihre persönlichen Einstellungen (gitignoriert) |

Erstellen Sie `CLAUDE.local.md` im Projektstammverzeichnis für Anweisungen, die nur für Sie gelten — bevorzugte Sprache, Arbeitsablaufgewohnheiten, Tool-Präferenzen.
