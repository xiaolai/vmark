# KI-Integration (MCP)

VMark enthält einen integrierten MCP-Server (Model Context Protocol), der es KI-Assistenten wie Claude ermöglicht, direkt mit Ihrem Editor zu interagieren.

## Was ist MCP?

Das [Model Context Protocol](https://modelcontextprotocol.io/) ist ein offener Standard, der es KI-Assistenten ermöglicht, mit externen Tools und Anwendungen zu interagieren. VMark's MCP-Server macht seine Editor-Fähigkeiten als Tools zugänglich, die KI-Assistenten verwenden können, um:

- Dokumentinhalte zu lesen und zu schreiben
- Formatierung anzuwenden und Strukturen zu erstellen
- Dokumente zu navigieren und zu verwalten
- Spezielle Inhalte einzufügen (Mathematik, Diagramme, Wiki-Links)

## Schnelleinrichtung

VMark macht es einfach, KI-Assistenten mit einem Klick zu verbinden.

### 1. MCP-Server aktivieren

Öffnen Sie **Einstellungen → Integrationen** und aktivieren Sie den MCP-Server:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP-Server-Einstellungen" />
</div>

- **MCP-Server aktivieren** - Einschalten, um KI-Verbindungen zu erlauben
- **Beim Start starten** - Automatisch starten, wenn VMark geöffnet wird
- **Bearbeitungen automatisch genehmigen** - KI-Änderungen ohne Vorschau anwenden (siehe unten)

### 2. Konfiguration installieren

Klicken Sie für Ihren KI-Assistenten auf **Installieren**:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP-Installationskonfiguration" />
</div>

Unterstützte KI-Assistenten:
- **Claude Desktop** - Anthropic's Desktop-App
- **Claude Code** - CLI für Entwickler
- **Codex CLI** - OpenAI's Coding-Assistent
- **Gemini CLI** - Google's KI-Assistent

::: info Andere MCP-kompatible Clients
Andere MCP-kompatible Clients wie Cursor, Windsurf und ähnliche Tools können sich ebenfalls mit dem MCP-Server von VMark verbinden. Konfigurieren Sie sie manuell, indem Sie auf den Pfad des MCP-Server-Binaries verweisen (siehe [Manuelle Konfiguration](#manuelle-konfiguration) unten).
:::

#### Statussymbole

Jeder Anbieter zeigt einen Status-Indikator:

| Symbol | Status | Bedeutung |
|--------|--------|-----------|
| ✓ Grün | Gültig | Konfiguration ist korrekt und funktioniert |
| ⚠ Amber | Pfad-Diskrepanz | VMark wurde verschoben — klicken Sie auf **Reparieren** |
| ✗ Rot | Binary fehlt | MCP-Binary nicht gefunden — VMark neu installieren |
| ○ Grau | Nicht konfiguriert | Nicht installiert — klicken Sie auf **Installieren** |

::: tip VMark verschoben?
Wenn Sie VMark.app an einen anderen Ort verschoben haben, zeigt der Status amber "Pfad-Diskrepanz". Klicken Sie einfach auf die Schaltfläche **Reparieren**, um die Konfiguration mit dem neuen Pfad zu aktualisieren.
:::

### 3. KI-Assistenten neu starten

Nach der Installation oder Reparatur **starten Sie Ihren KI-Assistenten vollständig neu** (beenden und erneut öffnen), um die neue Konfiguration zu laden. VMark zeigt nach jeder Konfigurationsänderung eine Erinnerung.

### 4. Ausprobieren

Versuchen Sie in Ihrem KI-Assistenten Befehle wie:
- *"Was steht in meinem VMark-Dokument?"*
- *"Schreibe eine Zusammenfassung zu Quantencomputing in VMark"*
- *"Füge ein Inhaltsverzeichnis zu meinem Dokument hinzu"*

## In Aktion sehen

Stellen Sie Claude eine Frage und lassen Sie die Antwort direkt in Ihr VMark-Dokument schreiben:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop verwendet VMark MCP" />
  <p class="screenshot-caption">Claude Desktop ruft <code>document</code> → <code>set_content</code> auf, um in VMark zu schreiben</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Inhalt wird in VMark gerendert" />
  <p class="screenshot-caption">Der Inhalt erscheint sofort in VMark, vollständig formatiert</p>
</div>

<!-- Styles in style.css -->

## Manuelle Konfiguration

Wenn Sie manuell konfigurieren möchten, finden Sie hier die Konfigurationsdatei-Speicherorte:

### Claude Desktop

Bearbeiten Sie `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) oder `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

Bearbeiten Sie `~/.claude.json` oder das Projekt `.mcp.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

Bearbeiten Sie `~/.codex/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Gemini CLI

Bearbeiten Sie `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

::: tip Binary-Pfad finden
Auf macOS befindet sich der MCP-Server-Binary innerhalb von VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

Unter Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

Unter Linux:
- `/usr/bin/vmark-mcp-server` (oder wo Sie es installiert haben)

Der Port wird automatisch erkannt — keine `args` erforderlich.
:::

## Funktionsweise

```text
KI-Assistent <--stdio--> MCP-Server <--WebSocket--> VMark-Editor
```

1. **VMark startet eine WebSocket-Brücke** auf einem verfügbaren Port beim Start
2. **Der MCP-Server** liest den Port und das Authentifizierungstoken aus dem App-Datenverzeichnis von VMark
3. **Der MCP-Server** verbindet sich und authentifiziert sich über die WebSocket-Brücke
4. **KI-Assistent** kommuniziert mit dem MCP-Server über stdio
5. **Befehle werden weitergeleitet** an VMark's Editor über die Brücke

## Verfügbare Fähigkeiten

Wenn verbunden, kann Ihr KI-Assistent:

| Kategorie | Fähigkeiten |
|-----------|------------|
| **Dokument** | Inhalt lesen/schreiben, suchen, ersetzen |
| **Auswahl** | Auswahl abrufen/setzen, ausgewählten Text ersetzen |
| **Formatierung** | Fett, kursiv, Code, Links und mehr |
| **Blöcke** | Überschriften, Absätze, Code-Blöcke, Zitate |
| **Listen** | Aufzählungs-, geordnete und Aufgabenlisten |
| **Tabellen** | Zeilen/Spalten einfügen, ändern |
| **Spezial** | Mathematikgleichungen, Mermaid-Diagramme, Wiki-Links |
| **Arbeitsbereich** | Dokumente öffnen/speichern, Fenster verwalten |

Sehen Sie die [MCP-Werkzeuge-Referenz](/de/guide/mcp-tools) für vollständige Dokumentation.

## MCP-Status überprüfen

VMark bietet mehrere Möglichkeiten, den MCP-Server-Status zu überprüfen:

### Statusleisten-Indikator

Die Statusleiste zeigt einen **MCP**-Indikator auf der rechten Seite:

| Farbe | Status |
|-------|--------|
| Grün | Verbunden und läuft |
| Grau | Getrennt oder gestoppt |
| Pulsierend (animiert) | Startet |

Der Start wird normalerweise innerhalb von 1-2 Sekunden abgeschlossen.

Klicken Sie auf den Indikator, um den detaillierten Statusdialog zu öffnen.

### Status-Dialog

Zugriff über **Hilfe → MCP-Server-Status** oder Klick auf den Statusleisten-Indikator.

Der Dialog zeigt:
- Verbindungszustand (Gesund / Fehler / Gestoppt)
- Brücken-Laufzustand und Port
- Server-Version
- Verfügbare Tools (12) und Ressourcen (4)
- Zeit der letzten Zustandsprüfung
- Vollständige Liste der verfügbaren Tools mit Kopierschaltfläche

### Einstellungspanel

In **Einstellungen → Integrationen**, wenn der Server läuft, sehen Sie:
- Versionsnummer
- Tool- und Ressourcenanzahl
- **Verbindung testen**-Schaltfläche — führt eine Zustandsprüfung durch
- **Details anzeigen**-Schaltfläche — öffnet den Statusdialog

## Fehlerbehebung

### "Verbindung abgelehnt" oder "Kein aktiver Editor"

- Sicherstellen, dass VMark läuft und ein Dokument geöffnet ist
- Überprüfen, ob der MCP-Server in Einstellungen → Integrationen aktiviert ist
- Prüfen, ob die MCP-Brücke den Status "Läuft" anzeigt
- VMark neu starten, wenn die Verbindung unterbrochen wurde

### Pfad-Diskrepanz nach dem Verschieben von VMark

Wenn Sie VMark.app an einen anderen Ort verschoben haben (z.B. von Downloads zu Programme), verweist die Konfiguration auf den alten Pfad:

1. Öffnen Sie **Einstellungen → Integrationen**
2. Achten Sie auf das amber ⚠ Warnsymbol neben betroffenen Anbietern
3. Klicken Sie auf **Reparieren**, um den Pfad zu aktualisieren
4. Starten Sie Ihren KI-Assistenten neu

### Tools erscheinen nicht im KI-Assistenten

- Starten Sie Ihren KI-Assistenten nach der Installation der Konfiguration neu
- Überprüfen Sie, ob die Konfiguration installiert wurde (grünes Häkchen in Einstellungen prüfen)
- Überprüfen Sie die Protokolle Ihres KI-Assistenten auf MCP-Verbindungsfehler

### Befehle scheitern mit "Kein aktiver Editor"

- Sicherstellen, dass ein Dokument-Tab in VMark aktiv ist
- In den Editor-Bereich klicken, um ihn zu fokussieren
- Einige Befehle erfordern, dass Text zuerst ausgewählt wird

## Vorschlagssystem & Automatische Genehmigung

Standardmäßig erstellt VMark **Vorschläge**, die Ihre Genehmigung erfordern, wenn KI-Assistenten Ihr Dokument ändern (Inhalt einfügen, ersetzen oder löschen):

- **Einfügen** - Neuer Text erscheint als Ghost-Text-Vorschau
- **Ersetzen** - Originaltext hat Durchstreichung, neuer Text als Ghost-Text
- **Löschen** - Zu entfernender Text erscheint mit Durchstreichung

Drücken Sie **Eingabe**, um anzunehmen, oder **Escape**, um abzulehnen. Dies bewahrt Ihren Rückgängig/Wiederholen-Verlauf und gibt Ihnen die volle Kontrolle.

### Automatischer Genehmigungsmodus

::: warning Mit Vorsicht verwenden
Das Aktivieren von **Bearbeitungen automatisch genehmigen** umgeht die Vorschauvorschau und wendet KI-Änderungen sofort an. Aktivieren Sie dies nur, wenn Sie Ihrem KI-Assistenten vertrauen und schnellere Bearbeitung wünschen.
:::

Wenn die automatische Genehmigung aktiviert ist:
- Änderungen werden direkt ohne Vorschau angewendet
- Rückgängig (Mod+Z) funktioniert weiterhin, um Änderungen rückgängig zu machen
- Antwortnachrichten enthalten "(automatisch genehmigt)" für Transparenz

Diese Einstellung ist nützlich für:
- Schnelle KI-gestützte Schreibabläufe
- Vertrauenswürdige KI-Assistenten mit klar definierten Aufgaben
- Batch-Operationen, bei denen das Vorschauen jeder Änderung unpraktisch ist

## Sicherheitshinweise

- Der MCP-Server akzeptiert nur lokale Verbindungen (localhost)
- Es werden keine Daten an externe Server gesendet
- Die gesamte Verarbeitung findet auf Ihrem Rechner statt
- Die WebSocket-Brücke ist nur lokal zugänglich
- Die automatische Genehmigung ist standardmäßig deaktiviert, um unbeabsichtigte Änderungen zu verhindern

## Nächste Schritte

- Alle verfügbaren [MCP-Werkzeuge](/de/guide/mcp-tools) erkunden
- Mehr über [Tastaturkürzel](/de/guide/shortcuts) erfahren
- Weitere [Funktionen](/de/guide/features) entdecken
