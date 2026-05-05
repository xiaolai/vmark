# Fehlerbehebung

## Schnellnachschlag

Häufige Probleme und wo Sie die Lösung finden:

| Symptom | Mögliche Ursache | Wo nachsehen |
|---|---|---|
| MCP-Client kann sich nicht verbinden | Veraltete Port-Datei oder VMark läuft nicht | [MCP-Server-Verbindungsprobleme](#mcp-server-verbindungsprobleme) |
| Datei lässt sich nicht öffnen oder zeigt verstümmelten Text | Nicht-UTF-8-Kodierung oder Quarantäne-Attribut | [Datei lässt sich nicht öffnen](#datei-lasst-sich-nicht-offnen) |
| KI-Genie hängt oder antwortet nicht | Anbieter falsch konfiguriert oder CLI nicht im PATH | [KI-Genie reagiert nicht](#ki-genie-reagiert-nicht) |
| Tastenkürzel reagiert nicht | In den Einstellungen neu zugewiesen oder System-Override | [Tastenkürzel funktioniert nicht](#tastenkurzel-funktioniert-nicht) |
| Langsamer Editor bei großen Dateien | Speicherverbrauch pro Tab + Eingabeverzögerung bei 10.000+ Zeilen | [Editor-Leistung](#editor-leistung) |
| Menü ist nach Sprachwechsel weiterhin auf Englisch | Menü wird beim Start neu aufgebaut | [Menüleiste zeigt nach Sprachwechsel weiterhin Englisch](#menuleiste-zeigt-nach-sprachwechsel-weiterhin-englisch) |
| PDF-Export unvollständig | Bildpfade oder Schreibrechte | [Export-/Druckprobleme](#export-druckprobleme) |
| Langsamer Start unter Windows | WebView2 + Antivirenscanning | [App startet unter Windows langsam](#app-startet-unter-windows-langsam) |

Für alles, was oben nicht aufgeführt ist, siehe [Fehler melden](#fehler-melden).

## Protokolldateien

VMark erstellt Protokolldateien, um bei der Diagnose von Problemen zu helfen. Die Protokolle enthalten Warnungen und Fehler sowohl vom Rust-Backend als auch vom Frontend.

### Speicherorte der Protokolldateien

| Plattform | Pfad |
|-----------|------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%APPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Protokollstufen

| Stufe | Was protokolliert wird | Produktion | Entwicklung |
|-------|------------------------|------------|-------------|
| Error | Fehler, Abstürze | Ja | Ja |
| Warn | Behebbare Probleme, Ausweichlösungen | Ja | Ja |
| Info | Meilensteine, Statusänderungen | Ja | Ja |
| Debug | Detaillierte Nachverfolgung | Nein | Ja |

### Protokollrotation

- Maximale Dateigröße: 5 MB
- Rotation: behält eine vorherige Protokolldatei
- Alte Protokolle werden automatisch ersetzt

## Fehler melden

Beim Melden eines Fehlers gib bitte Folgendes an:

1. **VMark-Version** — angezeigt im Badge der Navigationsleiste oder im Über-Dialog
2. **Betriebssystem** — macOS-Version, Windows-Build oder Linux-Distribution
3. **Schritte zur Reproduktion** — was du getan hast, bevor das Problem auftrat
4. **Protokolldatei** — hänge die relevanten Protokolleinträge an oder füge sie ein

Protokolleinträge sind mit Zeitstempel versehen und nach Modul gekennzeichnet (z. B. `[HotExit]`, `[MCP Bridge]`, `[Export]`), sodass relevante Abschnitte leicht zu finden sind.

### Relevante Protokolle finden

1. Öffne das Protokollverzeichnis aus der obigen Tabelle
2. Öffne die neueste `.log`-Datei
3. Suche nach `ERROR`- oder `WARN`-Einträgen in der Nähe des Zeitpunkts, an dem das Problem auftrat
4. Kopiere die relevanten Zeilen und füge sie deinem Fehlerbericht bei

## Häufige Probleme

### App startet unter Windows langsam

VMark ist für macOS optimiert. Unter Windows kann der Start aufgrund der WebView2-Initialisierung langsamer sein. Stelle sicher, dass:

- WebView2 Runtime auf dem neuesten Stand ist
- Die Antivirensoftware das App-Datenverzeichnis nicht in Echtzeit scannt

### Menüleiste zeigt nach Sprachwechsel weiterhin Englisch

Wenn die Menüleiste nach dem Sprachwechsel in den Einstellungen weiterhin Englisch anzeigt, starte VMark neu. Das Menü wird beim nächsten Start mit der gespeicherten Sprache neu aufgebaut.

### Terminal akzeptiert keine CJK-Satzzeichen

Behoben ab v0.6.5+. Aktualisiere auf die neueste Version.

### MCP-Server-Verbindungsprobleme

Der MCP-Server startet möglicherweise nicht oder Clients können sich nicht verbinden.

- Stelle sicher, dass VMark ausgeführt wird — der MCP-Server startet nur, wenn die App geöffnet ist.
- Überprüfe, ob kein anderer Prozess denselben Port verwendet. Der MCP-Server schreibt eine Port-Datei zur Client-Erkennung; veraltete Port-Dateien aus einer vorherigen Sitzung können Konflikte verursachen. Starte VMark neu, um sie zu regenerieren.
- Überprüfe die Protokolldatei auf `[MCP Bridge]`-Einträge, um Verbindungsfehler zu identifizieren.

### Tastenkürzel funktioniert nicht

Ein Tastenkürzel reagiert möglicherweise nicht, wenn es mit einer anderen Belegung in Konflikt steht oder angepasst wurde.

- Öffne Einstellungen (`Mod + ,`) und navigiere zum Tab **Tastenkürzel**, um zu prüfen, ob das Kürzel neu zugewiesen wurde.
- Suche nach doppelten Belegungen — wenn zwei Aktionen dieselbe Tastenkombination teilen, wird nur eine ausgeführt.
- Unter macOS können einige Tastenkürzel mit Systemeinstellungen in Konflikt stehen (z. B. Mission Control, Spotlight). Prüfe **Systemeinstellungen > Tastatur > Tastaturkurzbefehle**.

### Export-/Druckprobleme

Der PDF-Export kann hängen bleiben oder unvollständige Ausgabe erzeugen.

- Wenn Bilder im Export fehlen, überprüfe, ob Bildpfade relativ zum Dokument sind und die Dateien auf der Festplatte existieren. Absolute URLs und Remote-Bilder sollten erreichbar sein.
- Überprüfe die Dateiberechtigungen im Ausgabeverzeichnis — VMark benötigt Schreibzugriff, um die exportierte Datei zu speichern.
- Bei großen Dokumenten kann der Export länger dauern. Überprüfe die Protokolldatei auf `[Export]`-Einträge, wenn er hängen zu bleiben scheint.

### Datei lässt sich nicht öffnen

VMark kann eine Datei möglicherweise nicht öffnen oder zeigt verstümmelten Inhalt.

- Überprüfe, ob die Datei Leseberechtigungen für dein Benutzerkonto hat.
- VMark erwartet UTF-8-kodiertes Markdown. Dateien in anderen Kodierungen (z. B. GB2312, Shift-JIS) werden möglicherweise nicht korrekt angezeigt — konvertiere sie zuerst in UTF-8.
- Wenn die Datei von einem anderen Prozess gesperrt ist (z. B. ein Sync-Client oder Backup-Tool), schließe diesen Prozess und versuche es erneut.

### Editor-Leistung

Der Editor kann bei sehr großen Dateien oder vielen geöffneten Tabs langsam werden.

- Schließe unbenutzte Tabs, um Speicher freizugeben — jeder geöffnete Tab pflegt seinen eigenen Editor-Zustand.
- Sehr große Dokumente (über 10.000 Zeilen) können Eingabeverzögerungen verursachen. Erwäge, sie in kleinere Dateien aufzuteilen.
- Deaktiviere den Fokusmodus und den Schreibmaschinen-Modus, wenn sie nicht benötigt werden, da sie zusätzlichen Render-Overhead verursachen.

### KI-Genie reagiert nicht

KI-Genies benötigen einen konfigurierten KI-Anbieter, um zu funktionieren.

- Öffne Einstellungen und überprüfe, ob ein KI-Anbieter (z. B. Ollama, OpenAI, Anthropic) mit einem gültigen Modellnamen konfiguriert ist.
- Die Anbieter-CLI muss in deinem PATH verfügbar sein. Unter macOS haben GUI-Apps einen minimalen PATH — wenn die CLI über Homebrew installiert wurde, stelle sicher, dass dein Shell-Profil den richtigen Pfad exportiert.
- Überprüfe den Modellnamen auf Tippfehler. Ein falscher Modellname schlägt stillschweigend fehl oder gibt einen Fehler zurück.
