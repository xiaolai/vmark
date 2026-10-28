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
- **Beim Start beginnen** - Automatisch starten, wenn VMark geöffnet wird
- **Speichern an neuem Ort und Genie-Ergebnisse automatisch genehmigen** - Standardmäßig aus. Erlaubt einer KI, ein Dokument ohne Rückfrage unter einem *neuen* Pfad zu speichern, und lässt einen Genie sein Ergebnis direkt anwenden statt als Vorschlag. Gewöhnliche KI-Schreibvorgänge hängen nie davon ab — ihr Sicherheitsnetz ist der [Verlauf der Bearbeitungs-Prüfpunkte](#bearbeitungs-prufpunkte) (siehe [Wie Bearbeitungen funktionieren](#wie-bearbeitungen-funktionieren))

### 2. Konfiguration installieren

Klicken Sie für Ihren KI-Assistenten auf **Installieren**:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP-Installationskonfiguration" />
</div>

Unterstützte KI-Assistenten:
- **Claude Desktop** - Anthropic's Desktop-App
- **Claude Code** - CLI für Entwickler
- **Codex CLI** - OpenAI's Coding-Assistent
- **Antigravity CLI** - Googles `agy`, der Nachfolger von Gemini CLI
- **Grok CLI** - der Coding-Agent von xAI
- **opencode** - der quelloffene, anbieterunabhängige Terminal-Agent

**Installieren schreibt ein Zugangsdatum pro Client.** Neben dem Pfad zu VMarks MCP-Server legt Installieren ein geheimes Token in der eigenen Konfigurationsdatei des Clients ab, unter `env.VMARK_MCP_TOKEN` (`environment.VMARK_MCP_TOKEN` bei opencode). Jeder Client erhält sein eigenes Token, und es wird nirgendwo sonst gespeichert. Es teilt VMark mit, welcher Client sich verbindet, statt dem Namen zu vertrauen, den der Client angibt. Derzeit benötigen es nur delegierte Aktionen — das Beantworten einer Kohärenzfrage in Ihrem Namen mit `coherence_resolve`; jedes andere Tool funktioniert ohne. Installieren und **Reparieren** behalten ein noch gültiges Token; um ein neues auszustellen, deinstallieren Sie und installieren erneut. Starten Sie den KI-Client danach jeweils neu. Behandeln Sie das Token wie ein Passwort: Fügen Sie die Konfigurationsdatei nicht in ein Issue oder einen Chat ein.

::: info Gemini CLI wird nicht mehr unterstützt
Google hat Gemini CLI durch Antigravity ersetzt. Hat eine frühere VMark-Installation
einen `vmark`-Eintrag in `~/.gemini/settings.json` hinterlassen, zeigt der Bereich
Integrationen dafür eine Zeile **Eingestellt** mit einer Schaltfläche **Entfernen**;
neue Installationen zielen stattdessen auf Antigravity.
:::

::: info Andere MCP-kompatible Clients
Andere MCP-kompatible Clients wie Cursor, Windsurf und ähnliche Tools können sich ebenfalls mit dem MCP-Server von VMark verbinden. Konfigurieren Sie sie manuell, indem Sie auf den Pfad des MCP-Server-Binaries verweisen (siehe [Manuelle Konfiguration](#manuelle-konfiguration) unten).
:::

#### CC-Switch

Wenn Sie Ihre KI-CLIs mit CC-Switch verwalten, zeigt das Installationsprogramm auch eine Zeile **CC-Switch**. **Zu CC-Switch hinzufügen** öffnet einen `ccswitch://v1/import`-Link, der VMarks MCP-Server — seinen Binärpfad — an CC-Switch übergibt, das daraufhin den `vmark`-Eintrag in alle dort verwalteten CLIs schreibt; eine Kopierschaltfläche liefert Ihnen den Link selbst, falls Sie ihn lieber einfügen. Die Zeile ist deaktiviert, bis VMark seine eigene MCP-Binärdatei ermittelt hat.

#### Statussymbole

Jeder Anbieter zeigt einen Status-Indikator:

| Symbol | Status | Bedeutung |
|--------|--------|-----------|
| ✓ Grün | Gültig | Konfiguration ist korrekt und funktioniert |
| ⚠ Amber | Pfad-Diskrepanz | VMark wurde verschoben — klicken Sie auf **Reparieren** |
| ✗ Rot | Binary fehlt | MCP-Binary nicht gefunden — VMark neu installieren |
| 🗎 Rot | Konfiguration nicht lesbar | VMark kann die Konfigurationsdatei nicht lesen oder parsen, daher ist unbekannt, ob sie einen VMark-Eintrag enthält. Die Meldung nennt die Datei und den Grund. Reparieren oder verschieben Sie sie und klicken Sie dann auf **Erneut prüfen** — Installieren und Reparieren sind gesperrt, bis sie sich parsen lässt, denn das Schreiben in eine Datei, die VMark nicht lesen kann, könnte ihren Inhalt zerstören |
| ○ Grau | Nicht konfiguriert | Nicht installiert — klicken Sie auf **Installieren** |

::: tip VMark verschoben?
Wenn Sie VMark.app an einen anderen Ort verschoben haben, zeigt der Status amber „Pfad-Diskrepanz“. Klicken Sie einfach auf die Schaltfläche **Reparieren**, um die Konfiguration mit dem neuen Pfad zu aktualisieren.
:::

### 3. KI-Assistenten neu starten

Nach der Installation oder Reparatur **starten Sie Ihren KI-Assistenten vollständig neu** (beenden und erneut öffnen), um die neue Konfiguration zu laden. VMark zeigt nach jeder Konfigurationsänderung eine Erinnerung.

### 4. Ausprobieren

Versuchen Sie in Ihrem KI-Assistenten Befehle wie:
- *„Was steht in meinem VMark-Dokument?“*
- *„Schreibe eine Zusammenfassung zu Quantencomputing in VMark“*
- *„Füge ein Inhaltsverzeichnis zu meinem Dokument hinzu“*

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

### Antigravity CLI

Bearbeiten Sie `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Grok CLI

Bearbeiten Sie `~/.grok/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

Bearbeiten Sie `~/.config/opencode/opencode.json`. Das Schema von opencode weicht vom
`mcpServers`-Schema ab: Der Schlüssel ist `mcp`, und `command` ist ein einzelnes Array,
das das Programm und seine Argumente enthält:

```json
{
  "mcp": {
    "vmark": {
      "type": "local",
      "command": ["/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"],
      "enabled": true
    }
  }
}
```

Wenn Ihre eigenen Einstellungen in `opencode.jsonc` liegen, lassen Sie sie dort — opencode
führt beide Dateien zusammen, sodass VMarks Eintrag in `opencode.json` additiv ist. VMark
schreibt die reine JSON-Datei, weil es die Kommentare einer `.jsonc`-Datei nicht verlustfrei
zurückschreiben kann.

::: warning Ein vorhandener `vmark`-Eintrag in `opencode.jsonc` hat Vorrang
opencode führt `config.json`, dann `opencode.json`, dann `opencode.jsonc` zusammen, und
die zuletzt gelesene Datei hat Vorrang. Wenn Sie also früher von Hand einen `vmark`-Eintrag
in `opencode.jsonc` angelegt haben, überschreibt er den von VMark verwalteten — VMark meldet
den Anbieter als gültig, während opencode weiter Ihren älteren Eintrag (und dessen veralteten
Binärpfad) verwendet. Löschen Sie den handgeschriebenen `mcp.vmark`-Block aus
`opencode.jsonc` und überlassen Sie ihn dem Bereich Integrationen.
:::

::: tip Binary-Pfad finden
Auf macOS befindet sich der MCP-Server-Binary innerhalb von VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

Unter Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

Unter Linux:
- `/usr/bin/vmark-mcp-server` (oder wo Sie es installiert haben)

Der Port wird automatisch erkannt — keine `args` erforderlich.
:::

### CLI-Flags (erweitert)

Das MCP-Server-Binary unterstützt einige Flags für Diagnose und ältere Setups:

| Flag | Funktion |
|---|---|
| `--version` (oder `-v`) | Gibt die Version aus (muss mit dem laufenden VMark übereinstimmen) und beendet sich. |
| `--health-check` | Führt einen Selbsttest der Binärdatei durch und beendet sich: Es startet den MCP-Server gegen eine eingebaute Mock-Brücke, gibt seine Version und die Anzahl der Tools als JSON aus und endet mit einem Exit-Code ungleich null, wenn die Anzahl der Tools nicht der von diesem Build erwarteten entspricht. Es kontaktiert **kein** laufendes VMark — verwenden Sie es, um zu bestätigen, dass die Binärdatei läuft; verwenden Sie **Einstellungen → Integrationen**, um die laufende Brücke zu prüfen. |
| `--port <number>` | Manuelles Port-Override. Überspringt den Auto-Discovery-Handshake und verbindet sich auf dem angegebenen Port. Nur für ältere Setups nützlich, bei denen der Brücken-Port extern fest vorgegeben ist; der Auto-Discovery-Pfad ist bevorzugt. |

Beispiel:

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # Legacy / manuell
```

Jedes andere Argument — ein vertipptes Flag, `--port=9223` oder ein überzähliges Wort — wird abgelehnt: Das Programm gibt einen Aufruffehler aus und beendet sich mit Code 64, statt auf die automatische Erkennung zurückzufallen.

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

Wenn verbunden, verfügt Ihr KI-Assistent über zehn Tools:

| Tool | Was es abdeckt |
|------|----------------|
| `session` | Fenster, Tabs, das aktive Dokument und Browser-Tabs (nur lesend) |
| `workspace` | Neu, Öffnen, Speichern, Speichern unter, Schließen, Tabs wechseln, ein Fenster fokussieren, einen Arbeitsbereich öffnen |
| `document` | Das ganze Dokument als Markdown lesen und schreiben; CJK-Formatierungstransformationen |
| `selection` | Den ausgewählten Text lesen und ersetzen |
| `comments` | Review-Kommentare zum Dokument auflisten, beantworten und als erledigt markieren (ein Assistent kann sie nicht auflösen) |
| `workflow` | CST-sichere Patches und Validierung für GitHub-Actions-YAML |
| `browser` / `browser_read` | Automatisierung des eingebetteten Browsers unter macOS — die ändernde und die nur lesende Hälfte |
| `coherence` / `coherence_resolve` | Die Kohärenzschicht lesen; veraltete Kanten im Rahmen einer von Ihnen erteilten Delegation auflösen |

Formatierung ist kein eigenes Tool: Der Assistent schreibt Markdown, also sind Überschriften, Tabellen, Mathematik und Diagramme genau das, was er schreibt.

Sehen Sie die [MCP-Werkzeuge-Referenz](/de/guide/mcp-tools) für vollständige Dokumentation.

## MCP-Status überprüfen

VMark bietet mehrere Möglichkeiten, den MCP-Server-Status zu überprüfen:

### Statusleisten-Indikator

Die Statusleiste zeigt einen **MCP**-Indikator auf der rechten Seite. Wenn etwas Ihre
Aufmerksamkeit erfordert, erscheint neben dem Satellitensymbol ein kurzes Zustandswort;
eine funktionierende Verbindung ist einfach das grüne Symbol. Beim Darüberfahren werden
die aktuell verbundenen KI-Clients mit Name und Version aufgelistet:

| Farbe | Wort | Status |
|-------|------|--------|
| Grün | — | Verbunden und läuft |
| Grau | `aus` | Getrennt oder gestoppt |
| Pulsierend (animiert) | `…` | Startet |
| Rot | `Fehler` | Server ausgefallen — für den Grund darüberfahren |

Der Start wird normalerweise innerhalb von 1-2 Sekunden abgeschlossen.

Klicken Sie auf den Indikator, um **Einstellungen → Integrationen** zu öffnen.

### Einstellungspanel

**Einstellungen → Integrationen** ist die andere Statusoberfläche — es gibt keinen separaten Statusdialog. Solange die Brücke läuft, zeigt sie die Adresse, auf der sie lauscht (`localhost:<port>`, mit Kopierschaltfläche), und wie viele KI-Clients verbunden sind, alle paar Sekunden aktualisiert. Die Schaltfläche **Verbindung testen** (mit **Sidecar prüfen** beschriftet, solange die Brücke gestoppt ist) führt den eigenen `--health-check` des Sidecars aus und meldet die Sidecar-Version, die Anzahl seiner Tools und den Zeitpunkt der letzten Prüfung — sie bestätigt, dass die installierte Binärdatei funktioniert, nicht, dass ein Client verbunden ist.

## Fehlerbehebung

### „Verbindung abgelehnt“ oder „Kein aktiver Editor“

- Sicherstellen, dass VMark läuft und ein Dokument geöffnet ist
- Überprüfen, ob der MCP-Server in Einstellungen → Integrationen aktiviert ist
- Prüfen, ob die MCP-Brücke den Status „Läuft“ anzeigt
- VMark neu starten, wenn die Verbindung unterbrochen wurde

### Pfad-Diskrepanz nach dem Verschieben von VMark

Wenn Sie VMark.app an einen anderen Ort verschoben haben (z. B. von Downloads zu Programme), verweist die Konfiguration auf den alten Pfad:

1. Öffnen Sie **Einstellungen → Integrationen**
2. Achten Sie auf das amber ⚠ Warnsymbol neben betroffenen Anbietern
3. Klicken Sie auf **Reparieren**, um den Pfad zu aktualisieren
4. Starten Sie Ihren KI-Assistenten neu

### Tools erscheinen nicht im KI-Assistenten

- Starten Sie Ihren KI-Assistenten nach der Installation der Konfiguration neu
- Überprüfen Sie, ob die Konfiguration installiert wurde (grünes Häkchen in Einstellungen prüfen)
- Überprüfen Sie die Protokolle Ihres KI-Assistenten auf MCP-Verbindungsfehler

### Befehle scheitern mit „Kein aktiver Editor“

- Sicherstellen, dass ein Dokument-Tab in VMark aktiv ist
- In den Editor-Bereich klicken, um ihn zu fokussieren
- Einige Befehle erfordern, dass Text zuerst ausgewählt wird

## Wie Bearbeitungen funktionieren

Die reduzierte MCP-Oberfläche folgt dem Lese-Schreib-Rückgrat: KI-Assistenten rufen `document.read` auf, um den aktuellen Inhalt und ein Revisionstoken zu erhalten, denken darüber nach und rufen dann `document.write` mit dem neuen vollständigen Inhalt auf. Das Revisionstoken schützt vor stillem Überschreiben: Wenn Sie in VMark getippt haben, während die KI nachgedacht hat, liefert der Schreibvorgang `STALE`, und die KI liest erneut.

Für YAML-Dateien von GitHub-Actions-Workflows verwendet die KI stattdessen `workflow.apply_patch` — VMarks CST-bewusste Mutatoren bewahren Kommentare, Anker und Schlüsselreihenfolge, die beim Umschreiben des Rohtexts verloren gingen.

Für `document.write`, `selection.set` oder `workflow.apply_patch` gibt es keinen Vorschauschritt — die Änderung landet im Editor, sobald die Revisionsprüfung besteht. Das Sicherheitsnetz ist der [Verlauf der Bearbeitungs-Prüfpunkte](#bearbeitungs-prufpunkte) unten; wenn Sie vor dem Übernehmen prüfen möchten, halten Sie das Dokument unter Versionskontrolle mit git und sehen Sie sich den Diff an. Die einzige Genehmigungsschranke ist **Speichern an neuem Ort und Genie-Ergebnisse automatisch genehmigen**: Ist sie aus (Standard), kann eine KI ein Dokument nicht unter einem neuen Pfad speichern — `workspace.save_as` liefert `APPROVAL_REQUIRED`, und VMark zeigt einen Toast mit dem Dateinamen. Selbst wenn sie an ist, weigert sich `save_as`, eine andere vorhandene Datei zu überschreiben.

## Bearbeitungs-Prüfpunkte

Jede KI-Änderung an einem Dokument — `document.write`, `document.transform`, `selection.set` und `workflow.apply_patch` — wird im Bearbeitungsverlauf von VMark aufgezeichnet, bevor sie etwas ändert. Die Schaltfläche **Verlauf** in der Statusleiste öffnet ein Panel für das fokussierte Dokument. Ihr Zähler nennt die KI-Versionen des Dokuments, und die Schaltfläche nimmt eine Warnfarbe an, wenn Änderungen nicht aufgezeichnet werden. Das Panel aktualisiert sich live, in jedem Fenster, sobald Versionen aufgezeichnet werden.

Das Panel listet die Versionen des Dokuments auf, die neueste zuerst. Jede Zeile zeigt, wann sie entstand, welche Art von Änderung es war, das Tool und wer sie vorgenommen hat: den Anbieter des KI-Clients (zum Beispiel `claude` oder `codex`), seine Verbindung und seine Sitzungsbezeichnung. Ein Client ohne Token wird als **Nicht identifizierter Client** angezeigt, ein unbekanntes Token als **Unbekannte Zugangsdaten** und ein von mehreren Clients geteiltes Token als **Von mehreren Anbietern geteilte Zugangsdaten** — nie als Anbieter, welchen Namen sich der Client auch gibt. **Diese Version wiederherstellen** setzt den Text dieser Version zurück; **Stand vor dieser Änderung wiederherstellen** setzt den Text davor zurück. Eine Wiederherstellung erhöht die Revision des Dokuments, sodass ein KI-Client, der noch die alte Revision hält, bei seinem nächsten Schreibvorgang `STALE` erhält, statt Ihre Wiederherstellung zu überschreiben. Eine Wiederherstellung wird selbst aufgezeichnet: Der Text, den sie ersetzt, wird zuerst gesichert, und ein Dokument, das während der Wiederherstellung bearbeitet wurde, bleibt unverändert. Kann VMark nicht bestätigen, dass der Eintrag einer Wiederherstellung auf der Festplatte angekommen ist, warnt es Sie neben dem Ergebnis.

Über den Versionen listet **KI-Änderungen prüfen** die KI-Änderungen auf, die Sie noch nicht geprüft haben, gruppiert nach Client und Sitzung; Versionen, deren Änderungen alle geprüft sind, werden als Anzahl zusammengefasst. Jede Änderung bietet **Behalten** oder **Zurücknehmen** (danach **Behalten rückgängig machen** bzw. **Zurücknahme rückgängig machen**). Eine Zurücknahme, die Text überschreiben würde, den Sie seitdem bearbeitet haben, wird nicht ausgeführt: Die Änderung wird als Konflikt markiert, und sobald Sie ihn von Hand gelöst haben, hält **Als erledigt markieren** das fest. Eine Änderung, deren Position nicht mehr bestätigt werden kann, nennt den Grund und bietet keine automatische Zurücknahme. **Geprüfte abschließen** schließt nach einer Bestätigung alle geprüften Änderungen endgültig ab, denn das lässt sich nicht rückgängig machen. Ein Dokument fasst höchstens 500 ungeprüfte KI-Änderungen: An dieser Grenze weist ein Hinweis darauf hin, und KI-Bearbeitungen werden mit `REVIEW_BACKLOG_FULL` abgelehnt, bis Sie prüfen und abschließen. Eine Speicherung, die von einer anderen Version ausging als der davor — das Dokument wurde in zwei Fenstern bearbeitet —, wird so gekennzeichnet, mit beiden Wiederherstellungen, um die Zusammenführung rückgängig zu machen. **Beide Änderungen anzeigen** öffnet zwei Diffs dieser Speicherung: *Gegenüber der Ausgangsversion dieser Speicherung*, und *Gegenüber der vorherigen Version*, gegenüber der Version davor im Verlauf.

Darauf folgen unter **Kommentare** die Kommentar-Threads des Dokuments. **Auswahl kommentieren** zitiert den im Editor markierten Text (bei bloßem Cursor den Absatz, in dem er steht) und fügt Ihren Kommentar hinzu; ungespeicherter Text wird zuerst aufgezeichnet, sodass ein Kommentar nie auf eine ältere Version zeigt. Jeder Thread zeigt seinen Status — offen, bearbeitet, erledigt oder wieder geöffnet —, wer ihn geschrieben hat, den zitierten Text und die Antworten. Kommentare werden als reiner Text angezeigt: HTML in einem Kommentar wird dargestellt, nie ausgeführt. Kommt der zitierte Text inzwischen mehrfach vor, nennt der Thread die Anzahl; ist er verschwunden, sagt der Thread das. Sie können in jedem Status **Antworten**, einen offenen oder wieder geöffneten Thread **Als bearbeitet markieren**, ihn **Erledigen** und einen erledigten **Wieder öffnen** oder **Löschen**; das Löschen fragt zuerst nach und kann nicht rückgängig gemacht werden. Solange ein Kommentar oder eine Antwort gesendet wird, lässt sich der Beitrag weder bearbeiten noch abbrechen, auch wenn Sie das Panel schließen und wieder öffnen; ein abgelehnter Beitrag bleibt erhalten, sodass Sie ihn ändern und erneut senden können. Nur Sie können einen Thread erledigen, wieder öffnen oder löschen. Ein Thread, der wieder geöffnet wurde, nachdem seine ursprüngliche Revision aus dem Verlauf entfernt wurde, zeigt *Revision der Erstellung nicht mehr vorhanden* und wird mit dem aktuellen Text abgeglichen.

Oben im Panel steht, wenn Änderungen nicht aufgezeichnet werden: Der Verlauf konnte nicht starten oder ist schreibgeschützt, er hängt hinterher (Einträge warten und sind noch nicht auf der Festplatte), das letzte Speichern dieses Dokuments wurde abgelehnt oder der Verlauf hat nicht rechtzeitig geantwortet, KI-Bearbeitungen wurden in einem Fenster mit zu vielen offenen Seiten abgelehnt, oder manche KI-Änderungen lassen sich nicht mehr automatisch rückgängig machen. Außerdem zählt das Panel KI-Bearbeitungen, die als Änderungen am ganzen Dokument aufgezeichnet wurden, weil ihr geänderter Bereich nicht bestätigt werden konnte. Eine Änderung, die sich nicht mehr automatisch rückgängig machen lässt, lautet **Blockiert: Grund (Herkunft)** und steht unter der letzten Version, an der ihre Stelle bestätigt war; diese wird hervorgehoben. Gibt es keine, sagt das Panel, dass die Stelle nicht verfügbar ist. Schreibvorgänge, die angewendet, aber nie aufgezeichnet wurden, stehen unter **Nicht protokollierte Schreibvorgänge**, jeweils mit Wiederherstellen und Verwerfen.

Um mehrere Sitzungen eines Clients zu unterscheiden, setzen Sie `VMARK_SESSION_LABEL` in der MCP-Konfiguration des Clients, neben `VMARK_MCP_TOKEN`:

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

Die Bezeichnung ist höchstens 128 UTF-8-Bytes lang und enthält keine Steuerzeichen; eine Bezeichnung, die die Regel verletzt, wird mit einer Warnung verworfen, und der Client verbindet sich ohne sie. Sie wird von der Konfiguration des Clients gewählt, dient daher nur der Anzeige und entscheidet nichts.

Der Verlauf liegt im Ordner `agent-journal` im App-Datenverzeichnis von VMark und übersteht so einen Neustart. Der Ordner enthält den vollständigen vorherigen Text jeder aufgezeichneten Bearbeitung und ist nur für den Eigentümer zugänglich (`0700` unter macOS und Linux). Prüfpunkte aus einer früheren Version von VMark (eine `mcp-checkpoints.jsonl`, beim ersten Start importiert und dann umbenannt beiseitegelegt) stehen unter **Frühere Prüfpunkte**, eine Liste für alle Dokumente und Fenster. Wer einen wiederherstellt, öffnet seine Datei; ein unbenannter oder einer, dessen Datei sich nicht mehr öffnen lässt, wird in ein neues Dokument wiederhergestellt. Der Abschnitt zeigt, wie viel Prüfpunkttext aufbewahrt wird, und löscht alles — jede Datei und jedes Fenster — in einem Schritt, wobei die Texte von der Festplatte entfernt werden.

## Sicherheitshinweise

- Der MCP-Server akzeptiert nur lokale Verbindungen (localhost)
- Es werden keine Daten an externe Server gesendet
- KI-Dateioperationen sind auf den Stamm des geöffneten Arbeitsbereichs und die Ordner geöffneter Dokumente beschränkt — siehe [Datenschutz](/de/guide/privacy#was-ein-ki-assistent-erreichen-kann)
- Die gesamte Verarbeitung findet auf Ihrem Rechner statt
- Die WebSocket-Brücke ist nur lokal zugänglich
- Jeder installierte Client trägt sein eigenes `VMARK_MCP_TOKEN`. Ein Client ohne Token, mit einem unbekannten oder mit einem mit einem anderen Client geteilten Token verbindet sich trotzdem, aber seine delegierten Aktionen werden abgelehnt, mit einer Meldung, die Sie auffordert, für ihn unter **Einstellungen → Integrationen** Installieren auszuführen und ihn neu zu starten

## Nächste Schritte

- Alle verfügbaren [MCP-Werkzeuge](/de/guide/mcp-tools) erkunden
- Mehr über [Tastaturkürzel](/de/guide/shortcuts) erfahren
- Weitere [Funktionen](/de/guide/features) entdecken
