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
| `Cmd + R` / `Strg + R` bewirkt nichts | Neuladen ist absichtlich blockiert | [Neuladen ist blockiert](#neuladen-ist-blockiert) |
| Ein Doppelklick auf eine Datei hat sie im bereits laufenden VMark geöffnet | Weiterleitung an die einzelne Instanz unter Windows und Linux | [Nur eine VMark-Instanz unter Windows und Linux](#nur-eine-vmark-instanz-unter-windows-und-linux) |
| Leeres Fenster unter Linux | DMABUF-Renderer von WebKitGTK | [Leeres Fenster unter Linux](#leeres-fenster-unter-linux) |
| Gerade Anführungszeichen und `--` bleiben unter macOS unverändert | Die intelligenten Ersetzungen des Systems sind für VMark ausgeschaltet | [Intelligente Anführungszeichen und Gedankenstriche unter macOS](#intelligente-anfuhrungszeichen-und-gedankenstriche-unter-macos) |
| VMark „schläft“ in der Aktivitätsanzeige nie | App Nap ist deaktiviert, damit KI-Assistenten weiterarbeiten können | [VMark bleibt im Hintergrund wach](#vmark-bleibt-im-hintergrund-wach-app-nap) |
| Beim Öffnen eines zuletzt verwendeten Arbeitsbereichs erscheint ein Ordnerdialog, oder ein Fehler nennt `forbidden path` | Der Ordner liegt außerhalb dessen, was VMark lesen darf | [Ordnerzugriff und Fehler mit `forbidden path`](#ordnerzugriff-und-fehler-mit-forbidden-path) |

Für alles, was oben nicht aufgeführt ist, siehe [Fehler melden](#fehler-melden).

## Protokolldateien

VMark erstellt Protokolldateien, um bei der Diagnose von Problemen zu helfen. Die Protokolle enthalten Warnungen und Fehler sowohl vom Rust-Backend als auch vom Frontend.

### Speicherorte der Protokolldateien

| Plattform | Pfad |
|-----------|------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
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
- **macOS: Ein Doppelklick auf eine heruntergeladene Datei bewirkt nichts, während VMark läuft.** Von manchen Apps gespeicherte Dateien tragen das Download-Quarantäne-Attribut (`com.apple.quarantine`), und macOS kann die Anfrage, eine solche Datei in einer bereits laufenden App zu öffnen, stillschweigend verwerfen. Wenn du einen Arbeitsbereich öffnest, entfernt VMark das Attribut vom Arbeitsbereichsordner und von den Dateien direkt darin, die es öffnen kann (Unterordner bleiben unberührt) — das ist die Einstellung **Download-Quarantäne beim Öffnen des Arbeitsbereichs entfernen** unter **Einstellungen → Erweitert → macOS**, standardmäßig aktiviert. Für jede andere Datei verwende **Datei → Datei öffnen…** oder führe im Terminal `xattr -d com.apple.quarantine <file>` aus.

### Ordnerzugriff und Fehler mit `forbidden path`

Außerhalb deines Benutzerordners und eingebundener Laufwerke — unter Windows außerhalb der Laufwerke `C:\` bis `F:\` — liest VMark nur, wofür du ihm Zugriff gegeben hast; siehe [Was VMark auf dem Datenträger lesen kann](/de/guide/privacy#was-vmark-auf-dem-datentrager-lesen-kann).

- **Beim Öffnen eines zuletzt verwendeten Arbeitsbereichs erscheint ein Ordnerdialog.** VMark kann nicht bestätigen, dass du diesen Ordner schon einmal ausgewählt hast, und nichts anderes erlaubt ihm, dort zu lesen. Der Dialog öffnet sich bei genau diesem Ordner: Klicke auf **Öffnen**, um ihn zu bestätigen, dann merkt sich VMark ihn. Brichst du ab, wird nichts geöffnet.
- **Die Anfrage eines KI-Assistenten, einen Ordner zu öffnen, braucht einen weiteren Schritt.** Nachdem du die Anfrage genehmigt hast, zeigt VMark denselben Dialog; wähle den Ordner dort aus und lass den Assistenten es dann erneut versuchen.
- **Eine Fehlermeldung nennt `forbidden path`, oder ein Bild wird nicht angezeigt.** Die Datei liegt außerhalb aller Orte, die VMark lesen darf — oft ein Bild neben einem Dokument, das du einzeln geöffnet hast. Öffne den Ordner des Dokuments mit **Datei → Arbeitsbereich öffnen...**, um VMark den ganzen Ordner zu geben.

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

### Neuladen ist blockiert

`Cmd + R`, `Strg + R` und `Strg + Umschalt + R` bewirken absichtlich nichts. Ein Neuladen der Webview würde jeden geöffneten Editor, seinen Rückgängig-Verlauf und jeden ungespeicherten Zustand verwerfen, daher blockiert VMark die Tastenkürzel, den Pfad zum Entladen der Seite und das eigene Kontextmenü der Webview. Zwei Ausnahmen: `Strg + R` erreicht die Shell, wenn das integrierte Terminal fokussiert ist (Rückwärtssuche), und `F5` wird nie blockiert, weil es das Tastenkürzel für Source Peek ist. Entwicklungs-Builds warnen stattdessen nur vor ungespeicherten Dokumenten.

### Nur eine VMark-Instanz unter Windows und Linux

Ein Doppelklick auf eine Datei oder ein erneuter Start von VMark über einen Starter übergibt die Datei an das bereits laufende VMark und holt ein Fenster nach vorne, statt eine zweite Kopie zu starten. Ein zweiter Prozess würde die App-Daten, die Sitzung und den Fensterspeicher des ersten teilen, und die beiden würden gegenseitig ihren Zustand überschreiben — der Datenverlust hinter #1330. macOS verhält sich über das Betriebssystem schon immer so. Ein Entwicklungs-Build (`tauri dev`) verwendet einen eigenen Bezeichner und zählt daher als eigene App.

Wenn unter Windows das bereits laufende VMark nicht mehr reagiert und die Übergabe nicht mehr annehmen kann, startet ein erneuter Aufruf keine zweite Kopie daneben. Stattdessen erscheint eine Meldung: Öffnen Sie den Task-Manager, beenden Sie alle `VMark`-Prozesse und starten Sie VMark erneut (#1527).

Unter Linux beruht das auf dem D-Bus-Sitzungsbus. In einer Sitzung ohne verwendbare `DBUS_SESSION_BUS_ADDRESS` startet VMark zwar trotzdem, aber ohne diesen Schutz — ein erneuter Start öffnet dann eine zweite Kopie, mit dem oben beschriebenen Risiko —, und das Protokoll vermerkt, dass der Schutz aus ist. Starte VMark aus einer Desktop-Sitzung oder aus einer Shell, in der diese Variable gesetzt ist.

### Leeres Fenster unter Linux

Bei manchen Kombinationen aus AMD / Mesa / WebKitGTK (gemeldet wurde Arch mit KDE Plasma 6, #1058) versagt der DMABUF-Renderer von WebKitGTK, und der Inhaltsbereich bleibt leer. VMark setzt `WEBKIT_DISABLE_DMABUF_RENDERER=1`, bevor die Webview startet, damit das nicht passiert. Wenn du den DMABUF-Renderer zurückhaben möchtest, starte mit `WEBKIT_DISABLE_DMABUF_RENDERER=0` — VMark setzt die Variable nur, wenn du es nicht getan hast.

### Ein Tastenkürzel tippt ein Zeichen, während eine chinesische Eingabemethode aktiv ist

Behoben. Bei aktivierter chinesischer Zeichensetzung schreibt eine Eingabemethode die Satzzeichentasten um — die Backtick-Taste erzeugt `·`, die Klammern erzeugen `【】` — und sie übergibt dieses Zeichen, **bevor** die App erfährt, dass die Taste gedrückt wurde. Deshalb schaltete `` Strg + ` `` früher das Terminal um *und* hinterließ ein verirrtes `·` im Dokument, wodurch eine unveränderte Datei als bearbeitet markiert wurde.

VMark unterbindet jetzt das Einfügen selbst statt des Tastendrucks, sodass eine Befehlskombination nichts tippt. Gewöhnliches chinesisches Tippen, Tottasten (`Option + e`) und AltGr-Zeichen auf europäischen Tastaturen bleiben unberührt — abgewiesen werden nur Einfügungen, die eintreffen, während `Strg` oder `Cmd` gedrückt ist, und keine VMark-Tastenkombination bedeutet „tippe dieses Zeichen“.

Wenn du dennoch ein verirrtes Zeichen durch ein Tastenkürzel siehst, lohnt sich eine [Meldung](https://github.com/xiaolai/vmark/issues) mit dem Namen der Eingabemethode und der genauen Tastenkombination.

### Intelligente Anführungszeichen und Gedankenstriche unter macOS

Die Eingabe von `--` oder `"` bleibt in VMark unverändert, auch wenn auf deinem Mac *Intelligente Anführungszeichen und Striche verwenden* aktiviert ist. Andernfalls würde das System den Text unterhalb des Editors umschreiben — aus `-->` in einem Mermaid-Block wurde `—>` —, daher schaltet VMark die automatische Ersetzung von Strichen, Anführungszeichen und Punkten nur für seinen eigenen Prozess ab. Andere Apps sind nicht betroffen, ebenso wenig Eingabemethoden und deine eigenen Textersetzungen. Für typografische Anführungszeichen in VMark verwende die [Anführungszeichenregeln des CJK-Formatierers](/de/guide/cjk-formatting#typografische-anfuhrungszeichenstile) oder den Umschalter für den Anführungszeichenstil (`Umschalt + Mod + '`).

### VMark bleibt im Hintergrund wach (App Nap)

Unter macOS verzichtet VMark, solange es läuft, auf App Nap, sodass die Aktivitätsanzeige es selbst bei ausgeblendeten Fenstern nie als schlafend anzeigt. App Nap würde die Webview einfrieren — und mit ihr jede Anfrage eines KI-Assistenten (MCP) —, bis du ein Fenster nach vorne holst; wach zu bleiben ermöglicht es einem Assistenten, weiterzuarbeiten, während du in einer anderen App bist. Das System kann im Leerlauf dennoch in den Ruhezustand gehen; VMark bittet nur darum, nicht in App Nap versetzt zu werden.
