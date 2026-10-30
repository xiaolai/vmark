# KI-Anbieter

Die [KI-Genies](/de/guide/ai-genies) von VMark benötigen einen KI-Anbieter, um Vorschläge zu generieren. Sie können ein lokal installiertes CLI-Tool verwenden oder sich direkt mit einer REST-API verbinden.

## Schnelleinrichtung

Der schnellste Einstieg:

1. Öffnen Sie **Einstellungen > Integrationen**
2. Klicken Sie auf **Erkennen**, um nach installierten CLI-Tools zu suchen
3. Wenn ein CLI gefunden wird (z. B. Claude, Gemini), wählen Sie es aus — fertig
4. Wenn kein CLI verfügbar ist, wählen Sie einen REST-Anbieter, geben Sie Ihren API-Schlüssel ein und wählen Sie ein Modell

Es kann immer nur ein Anbieter gleichzeitig aktiv sein.

## CLI-Anbieter

CLI-Anbieter verwenden lokal installierte KI-Tools. VMark führt diese als Unterprozesse aus und streamt deren Ausgabe zurück in den Editor.

| Anbieter | CLI-Befehl | Installation |
|----------|-----------|-------------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### Wie CLI-Erkennung funktioniert

Klicken Sie in Einstellungen > Integrationen auf **Erkennen**. VMark durchsucht Ihren `$PATH` nach jedem CLI-Befehl und meldet die Verfügbarkeit. Wenn ein CLI gefunden wird, wird sein Optionsfeld wählbar. **Erkennen** sucht bei jedem Klick neu; die automatische Erkennung (beim App-Start, beim Öffnen der Einstellungen und im Anbieterwechsler der Genie-Auswahl) verwendet das Ergebnis der letzten Suche. Die Suche verwendet den `$PATH`, den VMark beim Start aus Ihrer Login-Shell gelesen hat; ein CLI, das in ein neu zum `$PATH` hinzugefügtes Verzeichnis installiert wurde, findet **Erkennen** daher erst nach einem Neustart von VMark.

### Vorteile

- **Kein API-Schlüssel erforderlich** — Das CLI verwaltet die Authentifizierung mit Ihrem bestehenden Login
- **Drastisch günstiger** — CLI-Tools nutzen Ihren Abonnementplan (z. B. Claude Max, ChatGPT Plus/Pro, Google One AI Premium), der eine feste monatliche Gebühr kostet. REST-API-Anbieter berechnen pro Token und können bei intensiver Nutzung 10–30× mehr kosten
- **Verwendet Ihre CLI-Konfiguration** — Modelleinstellungen, System-Prompts und Abrechnung werden vom CLI selbst verwaltet

::: tip Abonnement vs. API für Entwickler
Wenn Sie diese Tools auch für Vibe-Coding verwenden (Claude Code, Codex CLI, Gemini CLI), deckt dasselbe Abonnement sowohl die KI-Genies von VMark als auch Ihre Coding-Sitzungen ab — ohne Mehrkosten.
:::

### Einrichtung: Claude CLI

1. Claude Code installieren: `npm install -g @anthropic-ai/claude-code`
2. `claude` einmal im Terminal ausführen, um sich zu authentifizieren
3. In VMark auf **Erkennen** klicken, dann **Claude** auswählen

### Einrichtung: Gemini CLI

1. Gemini CLI installieren: `npm install -g @google/gemini-cli` (oder über das [offizielle Repository](https://github.com/google-gemini/gemini-cli))
2. `gemini` einmal ausführen, um sich mit Ihrem Google-Konto zu authentifizieren
3. In VMark auf **Erkennen** klicken, dann **Gemini** auswählen

## REST-API-Anbieter

REST-Anbieter verbinden sich direkt mit Cloud-APIs (oder lokalen APIs). Jeder benötigt einen Endpunkt, einen API-Schlüssel und einen Modellnamen. Antworten kommen in einem Stück an, wenn die Anfrage abgeschlossen ist — REST-Anbieter streamen keine Tokens; CLI-Anbieter schon.

| Anbieter | Standard-Endpunkt | Umgebungsvariable |
|----------|------------------|-------------------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| OpenAI-kompatibel | *(von Ihnen festgelegt)* | — |
| Google AI | *(integriert)* | `GOOGLE_API_KEY` oder `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### Konfigurationsfelder

Wenn Sie einen REST-Anbieter auswählen, erscheinen drei Felder:

- **API-Endpunkt** — Die Basis-URL (für Google AI ausgeblendet, da ein fester Endpunkt verwendet wird). Ein abschließendes `/v1` ist in Ordnung — VMark normalisiert es, sodass der Pfad nicht verdoppelt wird (z. B. funktionieren `https://host/v1` und `https://host` beide)
- **API-Schlüssel** — Ihr geheimer Schlüssel. Er wird im Anmeldedatenspeicher Ihres Betriebssystems aufbewahrt, nie in `localStorage` oder einer Klartext-Einstellungsdatei — siehe [Wo API-Schlüssel liegen](#wo-api-schlussel-liegen)
- **Modell** — Der Modell-Bezeichner (z. B. `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`)

### Automatisches Ausfüllen von Umgebungsvariablen

VMark liest standardmäßige Umgebungsvariablen aus seiner eigenen Prozessumgebung. Wenn `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` oder `GOOGLE_API_KEY` / `GEMINI_API_KEY` (in dieser Reihenfolge geprüft) gesetzt ist, wird das API-Schlüsselfeld automatisch ausgefüllt, wenn Sie diesen Anbieter auswählen.

Welche Variablen VMark sieht, hängt davon ab, wie es gestartet wurde. Ein Schlüssel, der in einem Shell-Profil wie `~/.zshrc` oder `~/.bashrc` exportiert wird:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

erreicht VMark nur, wenn Sie die App aus dieser Shell heraus starten. Über das Dock, den Finder, Spotlight oder einen Desktop-Starter gestartet, liest VMark Ihr Shell-Profil nicht, sodass das Feld leer bleibt — fügen Sie den Schlüssel stattdessen ein. Unter Windows funktioniert eine Benutzer- oder Systemumgebungsvariable unabhängig davon, wie VMark gestartet wird.

### Einrichtung: Anthropic (REST)

1. API-Schlüssel von [console.anthropic.com](https://console.anthropic.com) abrufen
2. In VMark Einstellungen > Integrationen **Anthropic** auswählen
3. API-Schlüssel einfügen
4. Modell auswählen (Standard: `claude-sonnet-4-5-20250929`)

### Einrichtung: OpenAI (REST)

1. API-Schlüssel von [platform.openai.com](https://platform.openai.com) abrufen
2. In VMark Einstellungen > Integrationen **OpenAI** auswählen
3. API-Schlüssel einfügen
4. Modell auswählen (Standard: `gpt-4o`)

### Einrichtung: OpenAI-kompatibel (DeepSeek, Groq, OpenRouter, …)

Viele Anbieter sprechen dasselbe Protokoll wie OpenAI (`/v1/chat/completions`, `Bearer`-Authentifizierung). Der Eintrag **OpenAI-kompatibel** verbindet sich mit jedem davon — DeepSeek, Groq, OpenRouter, Together, Moonshot, einem selbstgehosteten Gateway und so weiter — ohne eigenen Eintrag pro Anbieter.

Gegenüber den anderen REST-Anbietern kommt ein zusätzliches Feld hinzu: ein bearbeitbarer **Anbietername**, sodass die Zeile „DeepSeek“ (oder was immer Sie festlegen) statt der allgemeinen Bezeichnung zeigt.

Beispiel — DeepSeek:

1. API-Schlüssel von [platform.deepseek.com](https://platform.deepseek.com) abrufen
2. In VMark Einstellungen > Integrationen **OpenAI-kompatibel** auswählen
3. **Anbietername** auf `DeepSeek` setzen (optional, rein kosmetisch)
4. **API-Endpunkt** auf `https://api.deepseek.com` setzen (ein abschließendes `/v1` ist in Ordnung — VMark normalisiert es)
5. API-Schlüssel einfügen
6. **Modell** auf `deepseek-chat` (oder `deepseek-reasoner`) setzen. Direkt eintippen oder auf Aktualisieren klicken, um die Modellliste des Endpunkts abzurufen

Der Endpunkt ist erforderlich — für diesen Eintrag gibt es keinen Standard-Host. Verwenden Sie die Schaltflächen **Testen** (⚡) und **Modell testen** (🧪), um die Verbindung zu prüfen, bevor Sie ein Genie ausführen.

### Einrichtung: Google AI (REST)

1. API-Schlüssel von [aistudio.google.com](https://aistudio.google.com) abrufen
2. In VMark Einstellungen > Integrationen **Google AI** auswählen
3. API-Schlüssel einfügen
4. Modell auswählen (Standard: `gemini-2.0-flash`)

### Einrichtung: Ollama API (REST)

Verwenden Sie dies, wenn Sie REST-ähnlichen Zugriff auf eine lokale Ollama-Instanz wünschen oder Ollama auf einem anderen Rechner in Ihrem Netzwerk läuft.

1. Sicherstellen, dass Ollama läuft: `ollama serve`
2. In VMark Einstellungen > Integrationen **Ollama (API)** auswählen
3. Endpunkt auf `http://localhost:11434` setzen (oder Ihren Ollama-Host)
4. API-Schlüssel leer lassen
5. Modell auf Ihren heruntergeladenen Modellnamen setzen (z. B. `llama3.2`)

## Anbieter auswählen

| Situation | Empfehlung |
|-----------|-----------|
| Claude Code bereits installiert | **Claude (CLI)** — null Konfiguration, nutzt Ihr Abonnement |
| Codex oder Gemini bereits installiert | **Codex / Gemini (CLI)** — nutzt Ihr Abonnement |
| Privatsphäre / Offline benötigt | Ollama installieren → **Ollama (API)** unter `http://localhost:11434` |
| Benutzerdefiniertes oder selbstgehostetes Modell | **Ollama (API)** mit Ihrem Endpunkt |
| DeepSeek / Groq / OpenRouter / jede OpenAI-kompatible API | **OpenAI-kompatibel** — Endpunkt, Schlüssel und Modell festlegen |
| Günstigste Cloud-Option gewünscht | **Jeder CLI-Anbieter** — Abonnement ist drastisch günstiger als API |
| Kein Abonnement, nur leichte Nutzung | API-Schlüssel-Umgebungsvariable setzen → **REST-Anbieter** (pro Token) |
| Höchste Ausgabequalität benötigt | **Claude (CLI)** oder **Anthropic (REST)** mit `claude-sonnet-4-5-20250929` |

## Pro-Genie-Modellüberschreibung

Einzelne Genies können das Standardmodell des Anbieters mithilfe des `model`-Frontmatter-Felds überschreiben:

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

Dies ist nützlich, um einfache Aufgaben an schnellere/günstigere Modelle zu leiten, während ein leistungsfähiges Standardmodell beibehalten wird.

## Zuverlässigkeit und Timeouts

VMark sichert jeden Anbieteraufruf ab, sodass ein blockiertes CLI oder eine fehlerhafte API-Antwort den Editor niemals blockieren kann:

- **CLI-Unterprozess-Timeout**: Jede CLI-Anbieter-Anfrage wird unter einem Ausführungs-Timeout ausgeführt. Reagiert das CLI nicht, bricht VMark den Aufruf ab, gibt den Fehler an das Genie zurück und gibt den Worker frei — der Thread-Pool kann durch einen außer Kontrolle geratenen Unterprozess nicht blockiert werden.
- **REST-JSON-Parse-Sicherheit**: Gibt ein REST-Anbieter eine unerwartete Antwortstruktur zurück (HTML-Fehlerseite, abgeschnittenes JSON, Schema-Drift nach einer vorgelagerten Änderung), zeigt VMark dem Frontend einen typisierten Fehler an, anstatt den KI-Listener endlos warten zu lassen. Der Fehler wird im Status-Banner des Genies mit einer Option zum erneuten Versuch angezeigt.
- **Abbruch-Token**: Lang laufende Genie- oder Workflow-Schritte können jederzeit abgebrochen werden — Abbrechen im Genie-Picker oder Schließen des Panels bricht die laufende Anfrage sauber ab.
- **Gemeinsamer HTTP-Client**: REST-Anbieter teilen sich einen einzelnen verbindungsgepoolten `reqwest`-Client, sodass aufeinanderfolgende Genie-Aufrufe nicht jedes Mal den TCP/TLS-Handshake-Aufwand zahlen.
- **Windows-Pfaderkennung**: Unter Windows liest VMark beim Erkennen von CLIs den vollständigen `PATH` des Benutzers (einschließlich PowerShell-exklusiver Einträge), sodass benutzerseitig installierte Tools, die im Terminal funktionieren, auch in VMark funktionieren.

## Wo API-Schlüssel liegen

API-Schlüssel werden im Anmeldedatenspeicher des Betriebssystems aufbewahrt — macOS-Schlüsselbund, Windows-Anmeldeinformationsverwaltung oder Linux Secret Service — unter dem Dienstnamen `app.vmark.secrets`, ein Eintrag pro Anbieter. VMark hält nur für die laufende Sitzung eine Kopie im Speicher; die gespeicherten Anbietereinstellungen enthalten nie einen Schlüssel, und nichts wird in `localStorage` geschrieben. Ein Schlüssel, den eine ältere VMark-Version in einer Klartext-Einstellungsdatei gespeichert hat, wird beim ersten Laden durch die neuere Version in den Schlüsselbund verschoben, und die Klartext-Kopie wird erst entfernt, nachdem der Schreibvorgang in den Schlüsselbund erfolgreich zurückgelesen wurde.

Verweigert der Schlüsselbund einen Schreibvorgang, zeigt VMark eine Fehler-Toast-Meldung, statt den Schlüssel stillschweigend im Speicher zu behalten. Unter macOS kann ein ad hoc signierter Entwicklungs-Build nach jeder Neusignierung erneut nach Schlüsselbundzugriff fragen; ein Release-Build fragt einmal.

## Sicherheitshinweise

- **API-Schlüssel liegen im Schlüsselbund des Betriebssystems** — siehe oben; sie werden nie in die Einstellungsdateien von VMark oder in `localStorage` geschrieben
- **Umgebungsvariablen** werden gelesen, wenn Sie einen Anbieter auswählen, und füllen nur ein leeres Schlüsselfeld
- **CLI-Anbieter** verwenden Ihre bestehende CLI-Authentifizierung — VMark sieht Ihre Zugangsdaten nie
- **Alle Anfragen gehen direkt** von Ihrem Rechner an den Anbieter — keine VMark-Server dazwischen

## Fehlerbehebung

**„Kein KI-Anbieter verfügbar“** — Klicken Sie auf **Erkennen**, um nach CLIs zu suchen, oder konfigurieren Sie einen REST-Anbieter mit API-Schlüssel.

**CLI zeigt „Nicht gefunden“** — Das CLI ist nicht in Ihrem `$PATH`. Installieren Sie es oder überprüfen Sie Ihr Shell-Profil. Auf macOS erben GUI-Apps möglicherweise nicht den Terminal-`$PATH` — versuchen Sie, den Pfad zu `/etc/paths.d/` hinzuzufügen.

**CLI hängt / keine Antwort** — Das Ausführungs-Timeout von VMark bricht den Aufruf automatisch ab; im Status-Banner des Genies erscheint eine Fehlermeldung. Wenn ein bestimmtes CLI den Timeout regelmäßig überschreitet, führen Sie es einmal im Terminal aus, um zu bestätigen, dass es dort funktioniert, und prüfen Sie dann, ob eine interaktive Authentifizierung erforderlich ist.

**REST-Anbieter gibt 401 zurück** — Ihr API-Schlüssel ist ungültig oder abgelaufen. Generieren Sie einen neuen von der Konsole des Anbieters.

**REST-Anbieter gibt 429 zurück** — Sie haben ein Ratenlimit überschritten. Warten Sie einen Moment und versuchen Sie es erneut, oder wechseln Sie zu einem anderen Anbieter.

**REST-Anbieter gibt korrumpiertes / unerwartetes JSON zurück** — VMark zeigt einen typisierten Parse-Fehler an (z. B. „list_models returned an unexpected response shape“). Überprüfen Sie die Endpunkt-URL und stellen Sie sicher, dass der API-Vertrag zum ausgewählten Anbietertyp passt; manche selbstgehosteten Gateways kündigen OpenAI-kompatible URLs an, liefern aber ein anderes Schema aus.

**Langsame Antworten** — CLI-Anbieter fügen Unterprozess-Overhead hinzu. Für schnellere Antworten verwenden Sie REST-Anbieter, die direkt verbinden. Für die schnellste lokale Option verwenden Sie Ollama mit einem kleinen Modell.

**Fehler „Modell nicht gefunden“** — Der Modell-Bezeichner stimmt nicht mit dem überein, was der Anbieter anbietet. Überprüfen Sie die Dokumentation des Anbieters auf gültige Modellnamen.

## Siehe auch

- [KI-Genies](/de/guide/ai-genies) — KI-gestützte Schreibassistenz verwenden
- [MCP-Einrichtung](/de/guide/mcp-setup) — Externe KI-Integration über Model Context Protocol
